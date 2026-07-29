import { randomBytes } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  applyCors,
  handledPreflight,
  requireSession,
  sendError,
} from "../../../lib/http.js";
import {
  fetchMasterSarpras,
  fetchVendorMap,
  matchProvinceId,
} from "../../../lib/kdkmp.js";
import { enqueueProvinceSteps } from "../../../lib/queue.js";
import {
  buildColumns,
  mandatoryItems,
  newJobId,
  saveJob,
  savePoints,
  type JobMeta,
  type JobProvince,
  type ReportScope,
} from "../../../lib/report.js";
import { shouldRunInline } from "../../../lib/steps.js";

/**
 * `all` covers every koperasi with a vendor report (~18k across 35 provinces);
 * the rest narrow to one completion tier. `no_report` is absent on purpose —
 * those koperasi never appear in the source endpoint at all.
 */
const SUPPORTED_SCOPES: ReportScope[] = [
  "all",
  "mandatory_complete",
  "complete_all",
  "secondary_complete",
  "partial",
  "below_10",
];

/**
 * Kicks off the completion report.
 *
 * Cheap part runs inline (the national map is one ~1s call); the expensive part
 * — one ~4s/11MB `getCompleteMonitor` per province — is fanned out to QStash so
 * no single function invocation risks the platform timeout (ADR-0002).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
  if (handledPreflight(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const authed = await requireSession(req, res);
    if (!authed) return;

    const scope = (req.body?.scope ?? "mandatory_complete") as ReportScope;
    if (!SUPPORTED_SCOPES.includes(scope)) {
      return res.status(400).json({
        error: "bad_request",
        message: `Kategori tidak dikenal: ${scope}`,
      });
    }

    const { cookie } = authed.session;
    const [map, master] = await Promise.all([
      fetchVendorMap(cookie),
      fetchMasterSarpras(cookie),
    ]);

    // Membership comes from the portal's own verdict, never a formula of ours —
    // completion is judged per-koperasi against an allocation we can't see (ADR-0004).
    const targets =
      scope === "all"
        ? map.points
        : map.points.filter((point) => point.statusCategory === scope);

    if (targets.length === 0) {
      return res.status(200).json({
        jobId: null,
        totalExpected: 0,
        provinces: [],
        message: "Tidak ada koperasi pada kategori ini saat ini.",
      });
    }

    // Only provinces that actually contain a target need the heavy call.
    const byProvince = new Map<string, typeof targets>();
    const unmatched = new Set<string>();
    const resolved = new Map<string, string | null>();

    for (const point of targets) {
      const label = point.provinceNama ?? "";
      if (!resolved.has(label)) {
        resolved.set(label, label ? matchProvinceId(label, map.provinceOptions) : null);
      }
      const provinceId = resolved.get(label) ?? null;
      if (!provinceId) {
        unmatched.add(label || "(tanpa nama provinsi)");
        continue;
      }
      const bucket = byProvince.get(provinceId);
      if (bucket) bucket.push(point);
      else byProvince.set(provinceId, [point]);
    }

    if (byProvince.size === 0) {
      return res.status(502).json({
        error: "portal_error",
        message: `Tidak ada nama provinsi yang cocok dengan daftar provinsi portal: ${[...unmatched].join(", ")}`,
      });
    }

    const items = mandatoryItems(master);
    const jobId = newJobId();
    const provinces: JobProvince[] = [];

    for (const [provinceId, points] of byProvince) {
      const pointChunks = await savePoints(jobId, provinceId, points);
      const label = map.provinceOptions.find((o) => o.value === provinceId)?.label ?? provinceId;
      provinces.push({ id: provinceId, label, expected: points.length, pointChunks });
    }

    // Heaviest provinces first: in inline mode the user sees the slow ones get
    // out of the way early rather than stalling at the very end.
    provinces.sort((a, b) => b.expected - a.expected);

    const meta: JobMeta = {
      id: jobId,
      scope,
      sessionToken: authed.token,
      stepSecret: randomBytes(24).toString("base64url"),
      columns: buildColumns(items),
      items,
      provinces,
      totalExpected: provinces.reduce((sum, p) => sum + p.expected, 0),
      createdAt: Date.now(),
    };
    await saveJob(meta);

    const provinceIds = provinces.map((p) => p.id);
    const inline = shouldRunInline();

    if (!inline) {
      await enqueueProvinceSteps({ jobId, stepSecret: meta.stepSecret, provinceIds });
    }
    // In inline mode nothing is started here: a serverless invocation is torn
    // down as soon as it responds, so any work left running in the background
    // would simply be killed. The client drives the steps instead, one awaited
    // request per province — see run.ts.

    return res.status(202).json({
      jobId,
      scope,
      totalExpected: meta.totalExpected,
      provinces: provinces.map(({ id, label, expected }) => ({ id, label, expected })),
      skippedProvinces: [...unmatched],
      mode: inline ? "inline" : "queued",
    });
  } catch (err) {
    return sendError(res, err);
  }
}
