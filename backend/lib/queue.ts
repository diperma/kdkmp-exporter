import { Client } from "@upstash/qstash";
import { requireEnv } from "./kv.js";

/**
 * QStash drives the per-province steps of the heavy report (ADR-0002): it
 * retries a failed step on its own, which matters because one province call is
 * an ~11MB / 4s fetch that can plausibly flake.
 *
 * Steps authenticate with a per-job secret carried in the payload and checked
 * against the job record in KV, rather than QStash's request signature:
 * verifying that signature needs the exact raw request bytes, which Vercel has
 * already consumed and parsed by the time a function runs.
 */
export function enqueueProvinceSteps(options: {
  jobId: string;
  stepSecret: string;
  provinceIds: string[];
}): Promise<unknown[]> {
  const client = new Client({ token: requireEnv("QSTASH_TOKEN") });
  const base = requireEnv("PUBLIC_BASE_URL").replace(/\/$/, "");
  const url = `${base}/api/reports/mandatory-complete/step`;

  return Promise.all(
    options.provinceIds.map((provinceId) =>
      client.publishJSON({
        url,
        body: { jobId: options.jobId, provinceId, secret: options.stepSecret },
        retries: 3,
      }),
    ),
  );
}
