import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors, handledPreflight, sendError } from "../../lib/http.js";
import { portalLogin } from "../../lib/portal.js";
import { createSession } from "../../lib/session.js";

/**
 * Exchanges portalkdkmp.id credentials for one of our session tokens.
 *
 * The password is forwarded to the portal and then dropped — it is never
 * written to KV, logged, or returned (ADR-0003). Consequently there is no
 * silent re-login later: an expired portal cookie surfaces as a 401 and the
 * user logs in again.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
  if (handledPreflight(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const { username, password } = (req.body ?? {}) as {
      username?: string;
      password?: string;
    };
    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "bad_request", message: "Username dan kata sandi wajib diisi." });
    }

    const { cookie, expiresAt } = await portalLogin(username, password);
    const token = await createSession({ cookie, username, expiresAt });

    return res.status(200).json({ token, username, expiresAt });
  } catch (err) {
    return sendError(res, err);
  }
}
