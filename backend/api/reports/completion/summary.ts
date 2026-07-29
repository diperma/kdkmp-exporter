import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  applyCors,
  handledPreflight,
  requireSession,
  sendError,
} from "../../../lib/http.js";
import { fetchVendorMap, type StatusCategory } from "../../../lib/kdkmp.js";

const TIERS: StatusCategory[] = [
  "mandatory_complete",
  "complete_all",
  "secondary_complete",
  "partial",
  "below_10",
];

/**
 * Read-only counts per Sarpras Completion Tier, for the dashboard cards shown
 * before a user picks what to export. Deliberately separate from `start.ts`:
 * that endpoint's job is to kick off an export (it writes to KV), this one's
 * job is to answer "how many," and mixing the two would give a single endpoint
 * two reasons to change.
 *
 * `no_report` is excluded — koperasi with zero vendor reports never appear in
 * this source endpoint at all, so it can only ever count as zero.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
  if (handledPreflight(req, res)) return;

  try {
    const authed = await requireSession(req, res);
    if (!authed) return;

    const map = await fetchVendorMap(authed.session.cookie);

    const counts: Record<string, number> = Object.fromEntries(TIERS.map((t) => [t, 0]));
    for (const point of map.points) {
      const tier = point.statusCategory;
      if (tier in counts) counts[tier] = (counts[tier] ?? 0) + 1;
    }

    return res.status(200).json({
      total: map.points.length,
      counts,
      computedAt: Date.now(),
    });
  } catch (err) {
    return sendError(res, err);
  }
}
