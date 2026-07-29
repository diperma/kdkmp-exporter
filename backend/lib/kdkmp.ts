import { portalTrpcGet } from "./portal.js";

/**
 * Domain types for the endpoints this exporter uses. Shapes confirmed against
 * live responses on 2026-07-28 (see portalkdkmp-api-notes.md).
 *
 * Every interface is intentionally open-ended about extra keys: the source
 * system adds and renames fields without warning, and an export tool should
 * degrade rather than hard-fail when that happens.
 */

/** Completion tier. See CONTEXT.md — this is the portal's own verdict, and the
 *  only trustworthy one (ADR-0004). */
export type StatusCategory =
  | "complete_all"
  | "mandatory_complete"
  | "secondary_complete"
  | "partial"
  | "below_10"
  | "no_report";

export const STATUS_CATEGORY_LABELS: Record<StatusCategory, string> = {
  complete_all: "Semua sarpras lengkap (Biru)",
  mandatory_complete: "Primary lengkap (Hijau)",
  secondary_complete: "Secondary lengkap (Oranye)",
  partial: "Sarpras 10+ belum lengkap (Kuning)",
  below_10: "Sarpras di bawah 10 (Merah)",
  no_report: "Belum ada laporan vendor (Abu-abu)",
};

export interface KoperasiMapPoint {
  koperasiId: string;
  koperasiName: string;
  desaNama: string | null;
  kecamatanNama: string | null;
  kotaNama: string | null;
  provinceNama: string | null;
  kodimName: string | null;
  batch: string | null;
  totalLaporan: number | null;
  totalVendor: number | null;
  pengirimanCount: number | null;
  transitCount: number | null;
  tibaCount: number | null;
  terpasangCount: number | null;
  latestReportAt: string | null;
  completedSarprasCount: number | null;
  completedRequirementCount: number | null;
  totalRequirementCount: number | null;
  statusCategory: StatusCategory | string;
  lat: number | null;
  lng: number | null;
}

export interface RegionOption {
  value: string;
  label: string;
}

export interface VendorMapResponse {
  points: KoperasiMapPoint[];
  provinceOptions: RegionOption[];
  cityOptions: RegionOption[];
  districtOptions: RegionOption[];
  batchOptions: unknown[];
}

export interface MasterSarprasItem {
  id: string;
  name: string;
  jumlahUnitPerPaket: number | null;
  order: number | null;
  priority: "Mandatory" | "High" | "Medium" | "Secondary" | string;
  group: string | null;
  deskripsi: string | null;
}

export interface SarprasReport {
  status: string | null;
  vendorName: string | null;
  jumlahPaket: number | null;
  catatan: string | null;
}

export interface CompleteMonitorKoperasi {
  koperasiId: string;
  koperasiName: string;
  desaNama: string | null;
  kecamatanNama: string | null;
  kotaNama: string | null;
  progressPercentage: number | null;
  hasApprovedReport: boolean | null;
  batch: string | null;
  sarprasReports: Record<string, SarprasReport> | null;
}

export interface CompleteMonitorKodim {
  kodimId: string;
  kodimName: string;
  totalKoperasi: number | null;
  koperasiList: CompleteMonitorKoperasi[] | null;
}

export interface CompleteMonitorResponse {
  kodimList: CompleteMonitorKodim[];
  provinceOptions: RegionOption[];
}

/**
 * Words that carry no distinguishing information in an Indonesian province
 * name, so "Daerah Khusus Ibukota Jakarta" and "DKI Jakarta" reduce to the same
 * thing. The koperasi rows and the filter dropdown spell several provinces
 * differently, and the only join between them is the name.
 */
const PROVINCE_STOPWORDS = new Set([
  "daerah",
  "khusus",
  "istimewa",
  "ibukota",
  "ibu",
  "kota",
  "provinsi",
  "prov",
  "dki",
  "di",
]);

function significantTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token && !PROVINCE_STOPWORDS.has(token)),
  );
}

function sameTokens(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((token) => b.has(token));
}

/**
 * Resolves a province name from koperasi data to the id the detail endpoint
 * wants. Returns null when nothing matches, or when more than one option does —
 * guessing between "Riau" and "Kepulauan Riau" would silently produce a wrong
 * report, so an ambiguous name is reported as skipped instead.
 */
export function matchProvinceId(name: string, options: RegionOption[]): string | null {
  const exact = options.find((option) => option.label === name);
  if (exact) return exact.value;

  const target = significantTokens(name);
  if (target.size === 0) return null;

  const equal = options.filter((option) => sameTokens(significantTokens(option.label), target));
  if (equal.length === 1) return equal[0]!.value;
  if (equal.length > 1) return null;

  // Last resort: one name is a more qualified form of the other, and only one
  // option fits.
  const overlapping = options.filter((option) => {
    const candidate = significantTokens(option.label);
    if (candidate.size === 0) return false;
    const targetInCandidate = [...target].every((token) => candidate.has(token));
    const candidateInTarget = [...candidate].every((token) => target.has(token));
    return targetInCandidate || candidateInTarget;
  });
  return overlapping.length === 1 ? overlapping[0]!.value : null;
}

/** Statuses that mean the item physically reached the koperasi. */
export const DELIVERED_STATUSES = new Set(["tiba", "terpasang"]);

export function isDelivered(report: SarprasReport | undefined): boolean {
  return Boolean(report?.status && DELIVERED_STATUSES.has(report.status));
}

/**
 * The full nationwide vendor map. Returns every koperasi that has any vendor
 * report, unpaginated (~18k rows, ~1s) — no filters needed for a full pull.
 *
 * `batch`/`isPriority` must be *omitted*, not null, or the procedure 400s.
 */
export async function fetchVendorMap(cookie: string): Promise<VendorMapResponse> {
  return portalTrpcGet<VendorMapResponse>({
    procedure: "laporanVendor.getVendorReportedKoperasiMap",
    cookie,
    json: { provinceIds: [], cityIds: [], districtIds: [] },
    undefinedKeys: ["batch", "isPriority"],
  });
}

export async function fetchMasterSarpras(cookie: string): Promise<MasterSarprasItem[]> {
  return portalTrpcGet<MasterSarprasItem[]>({ procedure: "masterSarpras.list", cookie });
}

/**
 * Per-item detail for one province. Heavy: ~4s and ~11MB for Jawa Tengah, and
 * there is no way to narrow it server-side — hence the background job (ADR-0002).
 */
export async function fetchCompleteMonitor(
  cookie: string,
  provinceId: string,
): Promise<CompleteMonitorResponse> {
  return portalTrpcGet<CompleteMonitorResponse>({
    procedure: "laporanVendor.getCompleteMonitor",
    cookie,
    json: { provinceId, includeKoperasiList: true },
  });
}
