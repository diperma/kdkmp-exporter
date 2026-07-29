import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readSession, type PortalSession } from "./session.js";
import { PortalRequestError, PortalSessionExpiredError } from "./portal.js";

/**
 * Frontend (GitHub Pages) and backend (Vercel) are different origins, so every
 * response needs CORS headers. Auth rides in the Authorization header rather
 * than a cookie (ADR-0001), so no credentialed-CORS dance is required.
 */
export function applyCors(req: VercelRequest, res: VercelResponse): void {
  const allowed = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const origin = req.headers.origin;

  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

/** Returns true when the request was a preflight and has been answered. */
export function handledPreflight(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method !== "OPTIONS") return false;
  res.status(204).end();
  return true;
}

export interface Authed {
  token: string;
  session: PortalSession;
}

/**
 * Resolves the bearer token to a live portal session, or answers 401 itself.
 * Returns null when it has already responded.
 */
export async function requireSession(
  req: VercelRequest,
  res: VercelResponse,
): Promise<Authed | null> {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "unauthenticated", message: "Token tidak ada." });
    return null;
  }

  const session = await readSession(token);
  if (!session) {
    res
      .status(401)
      .json({ error: "session_expired", message: "Sesi berakhir. Silakan login ulang." });
    return null;
  }
  return { token, session };
}

/**
 * Single error funnel. A dead portal cookie surfaces as 401 so the frontend can
 * prompt a fresh login — we deliberately cannot re-login silently (ADR-0003).
 */
export function sendError(res: VercelResponse, err: unknown): void {
  if (err instanceof PortalSessionExpiredError) {
    res.status(401).json({ error: "session_expired", message: err.message });
    return;
  }
  if (err instanceof PortalRequestError) {
    res.status(502).json({ error: "portal_error", message: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : "Terjadi kesalahan tak terduga.";
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "internal_error", message });
}
