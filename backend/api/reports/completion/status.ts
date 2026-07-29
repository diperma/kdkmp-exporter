import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  applyCors,
  handledPreflight,
  requireSession,
  sendError,
} from "../../../lib/http.js";
import { readJob, summariseJob } from "../../../lib/report.js";

/**
 * A job still running after this long is treated as stuck rather than left
 * spinning. Generous because a full national export is 35 heavy province calls,
 * and QStash may be working through retries.
 */
const STALE_AFTER_MS = 30 * 60 * 1000;

/** Polled by the frontend every few seconds while the report builds. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
  if (handledPreflight(req, res)) return;

  try {
    const authed = await requireSession(req, res);
    if (!authed) return;

    const jobId = typeof req.query.jobId === "string" ? req.query.jobId : "";
    if (!jobId) return res.status(400).json({ error: "bad_request", message: "jobId wajib." });

    const meta = await readJob(jobId);
    if (!meta) return res.status(404).json({ error: "job_not_found" });
    if (meta.sessionToken !== authed.token) return res.status(403).json({ error: "forbidden" });

    const summary = await summariseJob(meta);
    const stale = summary.status === "running" && Date.now() - meta.createdAt > STALE_AFTER_MS;

    return res.status(200).json({
      jobId: meta.id,
      scope: meta.scope,
      status: stale ? "failed" : summary.status,
      error: stale
        ? "Job tidak selesai dalam 30 menit — kemungkinan ada langkah yang gagal berulang."
        : summary.error,
      progress: { done: summary.done, total: summary.total },
      totalExpected: meta.totalExpected,
      provinces: summary.provinces.map(({ id, label, expected, done, error }) => ({
        id,
        label,
        expected,
        done,
        error,
      })),
    });
  } catch (err) {
    return sendError(res, err);
  }
}
