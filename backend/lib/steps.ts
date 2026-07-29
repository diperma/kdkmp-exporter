import { fetchCompleteMonitor } from "./kdkmp.js";
import { readSession } from "./session.js";
import {
  buildRow,
  completeProvince,
  readJob,
  readPoints,
  readProvinceResult,
  saveRows,
} from "./report.js";

export interface StepOutcome {
  ok: boolean;
  rows?: number;
  reason?: "job_not_found" | "already_done" | "session_expired";
}

/**
 * Builds one province's rows. Shared by the queued path and the local inline
 * path so both behave identically — the only difference between them is who
 * calls this and whether failures get retried.
 *
 * Throws on transient failures (network, portal 5xx) so the queued caller can
 * let QStash retry. Permanent failures are recorded on the job and returned.
 */
export async function processProvince(
  jobId: string,
  provinceId: string,
): Promise<StepOutcome> {
  const meta = await readJob(jobId);
  if (!meta) return { ok: false, reason: "job_not_found" };

  const province = meta.provinces.find((p) => p.id === provinceId);
  // QStash retries can re-deliver a step that already succeeded.
  if (await readProvinceResult(jobId, provinceId)) {
    return { ok: true, rows: 0, reason: "already_done" };
  }

  const session = await readSession(meta.sessionToken);
  if (!session) {
    // Not worth retrying — the user's portal session is gone for good.
    await completeProvince(jobId, provinceId, {
      error: "Sesi portal berakhir sebelum job selesai.",
    });
    return { ok: false, reason: "session_expired" };
  }

  const points = await readPoints(jobId, provinceId, province?.pointChunks ?? 0);
  const monitor = await fetchCompleteMonitor(session.cookie, provinceId);

  const detailById = new Map(
    monitor.kodimList.flatMap((kodim) =>
      (kodim.koperasiList ?? []).map((k) => [k.koperasiId, k] as const),
    ),
  );

  const rows = points.map((point) =>
    buildRow(point, detailById.get(point.koperasiId), meta.items),
  );

  const rowChunks = await saveRows(jobId, provinceId, rows);
  await completeProvince(jobId, provinceId, { rowChunks });
  return { ok: true, rows: rows.length };
}

/**
 * True when there's no queue to hand work to — i.e. local development.
 *
 * QStash can't call back into `localhost`, so without this the job would sit at
 * 0/N forever on a dev machine. Guarded on VERCEL so a deployment with a
 * missing token fails loudly instead of quietly running everything inline and
 * hitting the function timeout.
 */
export function shouldRunInline(): boolean {
  return !process.env.QSTASH_TOKEN && process.env.VERCEL !== "1";
}

/**
 * Records a province as permanently failed. Used by the inline path, which has
 * no retry mechanism behind it the way the queued path has QStash.
 */
export async function failProvince(
  jobId: string,
  provinceId: string,
  message: string,
): Promise<void> {
  await completeProvince(jobId, provinceId, { error: message });
}
