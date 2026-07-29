import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors, handledPreflight, requireSession, sendError } from "../../lib/http.js";
import { deleteSession } from "../../lib/session.js";

/** GET: who am I. DELETE/POST with `{ "action": "logout" }`: end the session. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
  if (handledPreflight(req, res)) return;

  try {
    const authed = await requireSession(req, res);
    if (!authed) return;

    if (req.method === "POST" || req.method === "DELETE") {
      await deleteSession(authed.token);
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({
      username: authed.session.username,
      expiresAt: authed.session.expiresAt,
    });
  } catch (err) {
    return sendError(res, err);
  }
}
