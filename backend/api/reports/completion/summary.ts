import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  applyCors,
  handledPreflight,
  requireSession,
  sendError,
} from "../../../lib/http.js";
import { fetchVendorMap, matchProvinceId, type StatusCategory } from "../../../lib/kdkmp.js";

const TIERS: StatusCategory[] = [
  "mandatory_complete",
  "complete_all",
  "secondary_complete",
  "partial",
  "below_10",
];

function emptyCounts(): Record<string, number> {
  return Object.fromEntries(TIERS.map((t) => [t, 0]));
}

/**
 * Read-only counts per Sarpras Completion Tier, for the dashboard cards shown
 * before a user picks what to export. Deliberately separate from `start.ts`:
 * that endpoint's job is to kick off an export (it writes to KV), this one's
 * job is to answer "how many," and mixing the two would give a single endpoint
 * two reasons to change.
 *
 * Also breaks the same tally down per province — there is no portal endpoint
 * for this (checked 2026-07-29, see CONTEXT.md), so it's computed here from
 * the same single `getVendorReportedKoperasiMap` call rather than a second
 * fetch. Province names on `points` aren't canonical (e.g. "Aceh" and
 * "Aceh (NAD)" are the same province) — grouping uses `matchProvinceId` to
 * merge those variants under one label, the way exports already do.
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

    const counts = emptyCounts();
    const byProvinceId = new Map<
      string,
      { label: string; total: number; counts: Record<string, number> }
    >();
    const resolvedLabel = new Map<string, string | null>();

    for (const point of map.points) {
      const tier = point.statusCategory;
      if (tier in counts) counts[tier] = (counts[tier] ?? 0) + 1;

      const rawName = point.provinceNama ?? "";
      if (!resolvedLabel.has(rawName)) {
        const id = rawName ? matchProvinceId(rawName, map.provinceOptions) : null;
        const label = id
          ? (map.provinceOptions.find((o) => o.value === id)?.label ?? rawName)
          : rawName || "(tanpa nama provinsi)";
        resolvedLabel.set(rawName, label);
      }
      const label = resolvedLabel.get(rawName)!;

      const bucket = byProvinceId.get(label) ?? { label, total: 0, counts: emptyCounts() };
      bucket.total += 1;
      if (tier in bucket.counts) bucket.counts[tier] = (bucket.counts[tier] ?? 0) + 1;
      byProvinceId.set(label, bucket);
    }

    const byProvince = [...byProvinceId.values()].sort((a, b) => b.total - a.total);

    return res.status(200).json({
      total: map.points.length,
      counts,
      byProvince,
      computedAt: Date.now(),
    });
  } catch (err) {
    return sendError(res, err);
  }
}
