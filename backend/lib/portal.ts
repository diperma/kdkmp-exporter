/**
 * The one place that knows how to talk to portalkdkmp.id.
 *
 * Everything else in this app goes through here, so how the session cookie is
 * obtained and attached is a single-file concern (see CLAUDE.md "Auth strategy").
 */

const PORTAL_BASE = "https://portalkdkmp.id";

/** The portal returned 401/403 — the session cookie is dead. */
export class PortalSessionExpiredError extends Error {
  constructor() {
    super("Sesi portalkdkmp.id sudah tidak berlaku. Silakan login ulang.");
    this.name = "PortalSessionExpiredError";
  }
}

export class PortalRequestError extends Error {
  constructor(
    public readonly procedure: string,
    public readonly status: number,
    body: string,
  ) {
    super(`portalkdkmp.id ${procedure} gagal (HTTP ${status}): ${body.slice(0, 300)}`);
    this.name = "PortalRequestError";
  }
}

/**
 * Builds the `input` query param for a tRPC GET.
 *
 * superjson needs to be told which keys are *absent* rather than null: those go
 * in `meta.values` as `["undefined"]` and must be left out of `json` entirely.
 * Several procedures reject an explicit `null` where they accept an omission
 * (e.g. getVendorReportedKoperasiMap's `batch`/`isPriority`), so this
 * distinction is load-bearing, not cosmetic.
 */
export function encodeTrpcInput(
  json: Record<string, unknown> | null,
  undefinedKeys: string[] = [],
): string {
  const values: Record<string, string[]> | string[] =
    json === null
      ? ["undefined"]
      : Object.fromEntries(undefinedKeys.map((k) => [k, ["undefined"]]));

  return encodeURIComponent(JSON.stringify({ json, meta: { values, v: 1 } }));
}

/** Calls one tRPC procedure and unwraps `{result:{data:{json}}}`. */
export async function portalTrpcGet<T>(options: {
  procedure: string;
  cookie: string;
  json?: Record<string, unknown> | null;
  undefinedKeys?: string[];
}): Promise<T> {
  const { procedure, cookie, json = null, undefinedKeys = [] } = options;
  const input = encodeTrpcInput(json, undefinedKeys);

  const res = await fetch(`${PORTAL_BASE}/api/trpc/${procedure}?input=${input}`, {
    headers: { cookie, accept: "application/json" },
  });

  if (res.status === 401 || res.status === 403) throw new PortalSessionExpiredError();

  const body = await res.text();
  if (!res.ok) throw new PortalRequestError(procedure, res.status, body);

  const parsed = JSON.parse(body) as {
    result?: { data?: { json?: T } };
    error?: unknown;
  };
  if (parsed.error || parsed.result?.data?.json === undefined) {
    throw new PortalRequestError(procedure, res.status, body);
  }
  return parsed.result.data.json as T;
}

/**
 * Exchanges username+password for a session cookie.
 *
 * The password is used here and never stored — see ADR-0003. Callers must not
 * persist it, log it, or pass it any further than this function.
 */
export async function portalLogin(
  username: string,
  password: string,
): Promise<{ cookie: string; expiresAt: number }> {
  const res = await fetch(`${PORTAL_BASE}/api/auth/sign-in/username`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (res.status === 401 || res.status === 403) {
    throw new PortalSessionExpiredError();
  }
  if (!res.ok) {
    throw new PortalRequestError("auth/sign-in/username", res.status, await res.text());
  }

  const setCookies = res.headers.getSetCookie();
  if (setCookies.length === 0) {
    throw new PortalRequestError(
      "auth/sign-in/username",
      res.status,
      "login berhasil tapi tidak ada Set-Cookie di respons",
    );
  }

  const cookie = setCookies.map((c) => c.split(";", 1)[0]).join("; ");

  // Prefer the portal's own Max-Age; fall back to a conservative 12h so a stale
  // entry can't linger in KV forever if the header shape changes.
  const maxAge = setCookies
    .map((c) => /max-age=(\d+)/i.exec(c)?.[1])
    .find((v): v is string => Boolean(v));
  const ttlSeconds = maxAge ? Number(maxAge) : 12 * 60 * 60;

  return { cookie, expiresAt: Date.now() + ttlSeconds * 1000 };
}

/** Confirms a cookie is still live, and returns whatever profile the portal gives back. */
export async function portalGetProfile(cookie: string): Promise<unknown> {
  return portalTrpcGet<unknown>({ procedure: "users.getCurrentProfile", cookie });
}
