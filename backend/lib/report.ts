import { randomBytes } from "node:crypto";
import { kv } from "./kv.js";
import {
  STATUS_CATEGORY_LABELS,
  type CompleteMonitorKoperasi,
  type KoperasiMapPoint,
  type MasterSarprasItem,
  type StatusCategory,
} from "./kdkmp.js";

/**
 * Safety-net only. The primary cleanup path is `deleteJob`, called right after
 * a download finishes streaming — that frees the ~15-20MB a national "all" job
 * occupies (the free Upstash plan caps the whole database at 256MB) within
 * seconds of actual use, rather than waiting on a timer. This TTL only covers
 * jobs that are abandoned before ever being downloaded. It has to stay well
 * above how long a job can legitimately take to finish (QStash retries with
 * backoff have taken several minutes under contention) — a TTL shorter than
 * that would let a slow job's early-written `points` chunks expire before its
 * last province is processed, silently producing zero rows for that province
 * instead of an error. See docs/adr/0006-shorter-job-ttl-for-kv-quota.md and
 * docs/adr/0007-delete-job-data-after-download.md.
 */
const JOB_TTL_SECONDS = 60 * 60;

/**
 * KV values are capped (1MB per command on Upstash's free plan), and a single
 * province can hold thousands of koperasi — Jawa Tengah alone has ~4,700. So
 * both the input points and the output rows are stored in fixed-size slices
 * rather than one value per province.
 */
const ROWS_PER_CHUNK = 400;
const POINTS_PER_CHUNK = 800;

/** What a report covers: one completion tier, or every koperasi with a report. */
export type ReportScope = StatusCategory | "all";

export const SCOPE_LABELS: Record<string, string> = {
  ...STATUS_CATEGORY_LABELS,
  all: "Semua kategori",
};

export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

/** The subset of a sarpras item a report row needs; kept in the job record. */
export interface ReportItem {
  id: string;
  name: string;
}

export interface JobProvince {
  id: string;
  label: string;
  /** How many target koperasi we expect from this province. */
  expected: number;
  /** Number of stored slices of input points. */
  pointChunks: number;
}

/** Written by a step when its province finishes, to its own key. */
export interface ProvinceResult {
  /** Number of stored slices of output rows. */
  rowChunks?: number;
  error?: string;
}

export interface JobMeta {
  id: string;
  /** Which koperasi this export covers — the portal's own verdict (ADR-0004). */
  scope: ReportScope;
  /** Bearer token of the session this job runs on behalf of. */
  sessionToken: string;
  /** Shared secret each queued step must present — see lib/queue.ts. */
  stepSecret: string;
  columns: string[];
  items: ReportItem[];
  provinces: JobProvince[];
  totalExpected: number;
  createdAt: number;
}

const metaKey = (jobId: string) => `job:${jobId}:meta`;
const doneKey = (jobId: string, provinceId: string) => `job:${jobId}:done:${provinceId}`;
const rowsKey = (jobId: string, provinceId: string, index: number) =>
  `job:${jobId}:rows:${provinceId}:${index}`;
const pointsKey = (jobId: string, provinceId: string, index: number) =>
  `job:${jobId}:points:${provinceId}:${index}`;

export function newJobId(): string {
  return randomBytes(12).toString("base64url");
}

export async function saveJob(meta: JobMeta): Promise<void> {
  await kv.set(metaKey(meta.id), meta, { ex: JOB_TTL_SECONDS });
}

export async function readJob(jobId: string): Promise<JobMeta | null> {
  return (await kv.get<JobMeta>(metaKey(jobId))) ?? null;
}

function slice<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The target koperasi for one province, captured at job start.
 *
 * Stashing them means each step doesn't have to re-pull the ~18k-row national
 * map just to find its own province's rows — and it pins the job to a single
 * snapshot, so a job that spans a portal data update can't produce a report
 * that's internally inconsistent between provinces.
 *
 * Returns how many slices were written.
 */
export async function savePoints(
  jobId: string,
  provinceId: string,
  points: KoperasiMapPoint[],
): Promise<number> {
  const chunks = slice(points, POINTS_PER_CHUNK);
  await Promise.all(
    chunks.map((chunk, index) =>
      kv.set(pointsKey(jobId, provinceId, index), chunk, { ex: JOB_TTL_SECONDS }),
    ),
  );
  return chunks.length;
}

export async function readPoints(
  jobId: string,
  provinceId: string,
  chunkCount: number,
): Promise<KoperasiMapPoint[]> {
  const chunks = await Promise.all(
    Array.from({ length: chunkCount }, (_, index) =>
      kv.get<KoperasiMapPoint[]>(pointsKey(jobId, provinceId, index)),
    ),
  );
  return chunks.flatMap((chunk) => chunk ?? []);
}

export async function saveRows(
  jobId: string,
  provinceId: string,
  rows: ReportRow[],
): Promise<number> {
  const chunks = slice(rows, ROWS_PER_CHUNK);
  await Promise.all(
    chunks.map((chunk, index) =>
      kv.set(rowsKey(jobId, provinceId, index), chunk, { ex: JOB_TTL_SECONDS }),
    ),
  );
  return chunks.length;
}

export async function readProvinceRows(
  jobId: string,
  provinceId: string,
  rowChunks: number,
): Promise<ReportRow[]> {
  const chunks = await Promise.all(
    Array.from({ length: rowChunks }, (_, index) =>
      kv.get<ReportRow[]>(rowsKey(jobId, provinceId, index)),
    ),
  );
  return chunks.flatMap((chunk) => chunk ?? []);
}

/**
 * Marks one province finished, by writing to a key of its own.
 *
 * Under QStash the steps run concurrently, so completion must never be a
 * read-modify-write of one shared record: two steps finishing at the same
 * moment would each save a copy based on stale state, silently reverting the
 * other's province to unfinished — and since its step had already run, nothing
 * would ever mark it again and the job would hang forever.
 */
export async function completeProvince(
  jobId: string,
  provinceId: string,
  outcome: ProvinceResult = {},
): Promise<void> {
  await kv.set(doneKey(jobId, provinceId), outcome, { ex: JOB_TTL_SECONDS });
}

export async function readProvinceResult(
  jobId: string,
  provinceId: string,
): Promise<ProvinceResult | null> {
  return (await kv.get<ProvinceResult>(doneKey(jobId, provinceId))) ?? null;
}

export interface JobSummary {
  status: "running" | "complete" | "failed";
  done: number;
  total: number;
  error?: string;
  provinces: (JobProvince & { done: boolean; error?: string; rowChunks?: number })[];
}

/** Job state is derived from the per-province keys, never stored as one value. */
export async function summariseJob(meta: JobMeta): Promise<JobSummary> {
  const results = await Promise.all(
    meta.provinces.map((province) => readProvinceResult(meta.id, province.id)),
  );

  const provinces = meta.provinces.map((province, index) => {
    const result = results[index];
    return {
      ...province,
      done: result !== null,
      error: result?.error,
      rowChunks: result?.rowChunks,
    };
  });

  const done = provinces.filter((province) => province.done).length;
  const failed = provinces.filter((province) => province.error);
  const finished = done === provinces.length;

  return {
    status: finished ? (failed.length > 0 ? "failed" : "complete") : "running",
    done,
    total: provinces.length,
    error:
      finished && failed.length > 0
        ? `Gagal di provinsi: ${failed.map((p) => p.label).join(", ")}`
        : undefined,
    provinces,
  };
}

/**
 * Removes every key belonging to a job — meta, per-province done markers, and
 * all row/point chunks. Called right after a download finishes streaming
 * (ADR-0007), so the ~15-20MB a national job occupies is freed within seconds
 * of actual use rather than sitting until `JOB_TTL_SECONDS` expires.
 *
 * Takes the already-computed `summary` so it doesn't have to re-derive row
 * chunk counts from KV — the caller already paid for that read to stream the
 * download in the first place.
 */
export async function deleteJob(meta: JobMeta, summary: JobSummary): Promise<void> {
  const keys: string[] = [metaKey(meta.id)];

  for (const province of meta.provinces) {
    keys.push(doneKey(meta.id, province.id));
    for (let i = 0; i < province.pointChunks; i++) {
      keys.push(pointsKey(meta.id, province.id, i));
    }
  }
  for (const province of summary.provinces) {
    for (let i = 0; i < (province.rowChunks ?? 0); i++) {
      keys.push(rowsKey(meta.id, province.id, i));
    }
  }

  // Redis command size limits apply even to DEL — batch rather than one giant call.
  for (let i = 0; i < keys.length; i += 200) {
    await kv.del(...keys.slice(i, i + 200));
  }
}

/**
 * Every catalog item (all 29, all priority tiers — Mandatory through
 * Secondary), read live so a changed catalog isn't baked in. Items without an
 * `order` (newly added ones the portal hasn't ranked yet) sort after ranked
 * ones, alphabetically among themselves, rather than colliding at position 0.
 */
export function allSarprasItems(master: MasterSarprasItem[]): ReportItem[] {
  return master
    .slice()
    .sort((a, b) => {
      if (a.order != null && b.order != null) return a.order - b.order;
      if (a.order != null) return -1;
      if (b.order != null) return 1;
      return a.name.localeCompare(b.name);
    })
    .map((item) => ({ id: item.id, name: item.name }));
}

export function buildColumns(items: ReportItem[]): string[] {
  return [
    "Koperasi ID",
    "Nama Koperasi",
    "Provinsi",
    "Kabupaten/Kota",
    "Kecamatan",
    "Desa",
    "Kodim",
    "Batch",
    "Status Portal",
    "Progress Pembangunan (%)",
    "Sarpras Selesai",
    "Requirement Selesai",
    "Total Requirement",
    "Jumlah Laporan",
    "Jumlah Vendor",
    "Jumlah Tiba",
    "Jumlah Terpasang",
    "Laporan Terakhir",
    "Detail Per-Item",
    ...items.flatMap((item) => [`${item.name} — Status`, `${item.name} — Vendor`]),
    "Latitude",
    "Longitude",
  ];
}

/**
 * One export row per koperasi.
 *
 * Per-item columns report the raw status the portal recorded — we deliberately
 * do not derive our own "lengkap/belum" verdict, because completion is judged
 * against a per-koperasi Requirement Set we can't currently see (ADR-0004).
 *
 * ~13% of koperasi on the vendor map are missing from `getCompleteMonitor`
 * entirely (all of them `below_10`, all with 1-5 reports). For those, per-item
 * cells are left blank rather than filled with "belum ada laporan": the portal
 * says those koperasi *do* have vendor reports, so claiming otherwise would be
 * stating a falsehood where the honest answer is "unknown".
 */
export function buildRow(
  point: KoperasiMapPoint,
  detail: CompleteMonitorKoperasi | undefined,
  items: ReportItem[],
): ReportRow {
  const reports = detail?.sarprasReports ?? {};
  const row: ReportRow = {
    "Koperasi ID": point.koperasiId,
    "Nama Koperasi": point.koperasiName,
    Provinsi: point.provinceNama,
    "Kabupaten/Kota": point.kotaNama,
    Kecamatan: point.kecamatanNama,
    Desa: point.desaNama,
    Kodim: point.kodimName,
    Batch: point.batch,
    "Status Portal":
      STATUS_CATEGORY_LABELS[point.statusCategory as StatusCategory] ?? point.statusCategory,
    "Progress Pembangunan (%)": detail?.progressPercentage ?? null,
    "Sarpras Selesai": point.completedSarprasCount,
    "Requirement Selesai": point.completedRequirementCount,
    "Total Requirement": point.totalRequirementCount,
    "Jumlah Laporan": point.totalLaporan,
    "Jumlah Vendor": point.totalVendor,
    "Jumlah Tiba": point.tibaCount,
    "Jumlah Terpasang": point.terpasangCount,
    "Laporan Terakhir": point.latestReportAt,
    "Detail Per-Item": detail ? "tersedia" : "tidak tersedia di portal",
  };

  for (const item of items) {
    const report = detail ? reports[item.id] : undefined;
    row[`${item.name} — Status`] = detail ? (report?.status ?? "belum ada laporan") : null;
    row[`${item.name} — Vendor`] = report?.vendorName ?? null;
  }

  row["Latitude"] = point.lat;
  row["Longitude"] = point.lng;
  return row;
}
