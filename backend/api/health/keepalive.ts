import type { VercelRequest, VercelResponse } from "@vercel/node";
import { kv } from "../../lib/kv.js";

/**
 * Touches KV so Upstash's free-plan inactivity policy never sees this database
 * as dormant. It deleted the previous one after ~7 weeks of zero traffic
 * (confirmed via DNS: the old hostname became NXDOMAIN, not just unreachable —
 * see the incident this endpoint exists to prevent). Called on a schedule by
 * .github/workflows/keepalive.yml rather than relying on someone remembering
 * to open the app regularly.
 *
 * Deliberately unauthenticated: it only ever touches one fixed key, so there's
 * nothing for an uninvited caller to gain by hitting it, and requiring a
 * session here would defeat the purpose (the whole point is surviving periods
 * nobody logs in).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const now = new Date().toISOString();
    await kv.set("health:keepalive", now);
    return res.status(200).json({ ok: true, pingedAt: now });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Keepalive gagal menyentuh KV:", message);
    return res.status(502).json({ ok: false, error: message });
  }
}
