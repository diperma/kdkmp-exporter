import { randomBytes } from "node:crypto";
import { kv } from "./kv.js";

/**
 * Our own session: an opaque token handed to the frontend, mapping to the
 * portalkdkmp.id cookie held here. The frontend never sees the portal cookie,
 * and we never store the user's password (ADR-0001, ADR-0003).
 */
export interface PortalSession {
  /** Cookie header value to replay against portalkdkmp.id. */
  cookie: string;
  /** Username used to obtain it — for display only. */
  username: string;
  expiresAt: number;
}

const key = (token: string) => `session:${token}`;

export async function createSession(session: PortalSession): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const ttlSeconds = Math.max(60, Math.floor((session.expiresAt - Date.now()) / 1000));
  await kv.set(key(token), session, { ex: ttlSeconds });
  return token;
}

export async function readSession(token: string): Promise<PortalSession | null> {
  const session = await kv.get<PortalSession>(key(token));
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    await kv.del(key(token));
    return null;
  }
  return session;
}

export async function deleteSession(token: string): Promise<void> {
  await kv.del(key(token));
}
