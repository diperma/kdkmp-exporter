import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readJob } from "../../../lib/report.js";
import { processProvince } from "../../../lib/steps.js";

/**
 * One province of the report. Invoked by QStash, never by the browser.
 *
 * Transient failures return 5xx on purpose so QStash retries the step; the
 * province is only marked done once its rows are safely stored.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const { jobId, provinceId, secret } = (req.body ?? {}) as {
    jobId?: string;
    provinceId?: string;
    secret?: string;
  };
  if (!jobId || !provinceId || !secret) {
    return res.status(400).json({ error: "bad_request" });
  }

  const meta = await readJob(jobId);
  if (!meta) return res.status(404).json({ error: "job_not_found" });
  if (meta.stepSecret !== secret) return res.status(403).json({ error: "forbidden" });

  try {
    // A dead session is permanent, and processProvince records it rather than
    // throwing — so a 2xx here also means "stop retrying".
    const outcome = await processProvince(jobId, provinceId);
    return res.status(200).json(outcome);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Step gagal (job ${jobId}, provinsi ${provinceId}):`, message);
    return res.status(500).json({ error: "step_failed", message });
  }
}
