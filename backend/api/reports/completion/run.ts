import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  applyCors,
  handledPreflight,
  requireSession,
  sendError,
} from "../../../lib/http.js";
import { readJob } from "../../../lib/report.js";
import { failProvince, processProvince, shouldRunInline } from "../../../lib/steps.js";

/**
 * Local-development stand-in for the queue: processes exactly one province and
 * waits for it, so the client can drive the job province by province.
 *
 * This exists because a serverless invocation stops the moment it responds —
 * there is nowhere for a fire-and-forget background task to keep running. In
 * production QStash calls `step.ts` instead, and this route refuses to run.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
  if (handledPreflight(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const authed = await requireSession(req, res);
    if (!authed) return;

    if (!shouldRunInline()) {
      return res.status(400).json({
        error: "not_inline",
        message: "Antrian aktif — langkah dijalankan oleh QStash, bukan lewat endpoint ini.",
      });
    }

    const { jobId, provinceId } = (req.body ?? {}) as {
      jobId?: string;
      provinceId?: string;
    };
    if (!jobId || !provinceId) {
      return res.status(400).json({ error: "bad_request", message: "jobId dan provinceId wajib." });
    }

    const meta = await readJob(jobId);
    if (!meta) return res.status(404).json({ error: "job_not_found" });
    if (meta.sessionToken !== authed.token) return res.status(403).json({ error: "forbidden" });
    if (!meta.provinces.some((p) => p.id === provinceId)) {
      return res.status(400).json({ error: "bad_request", message: "Provinsi bukan bagian job." });
    }

    try {
      return res.status(200).json(await processProvince(jobId, provinceId));
    } catch (err) {
      // No retry behind this path, so record the failure and let the client
      // carry on with the remaining provinces.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[inline] provinsi ${provinceId} gagal:`, message);
      await failProvince(jobId, provinceId, message);
      return res.status(200).json({ ok: false, error: message });
    }
  } catch (err) {
    return sendError(res, err);
  }
}
