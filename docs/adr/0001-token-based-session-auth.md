# Token-based session auth instead of cross-site cookies

Frontend deploys to GitHub Pages (`*.github.io`), backend deploys to Vercel (`*.vercel.app`) — two different origins. The backend proxies login to `portalkdkmp.id` (per ADR-pending "Auth strategy: server-side login proxy" in CLAUDE.md) and holds the resulting portalkdkmp.id session cookie server-side.

For the frontend to authenticate its own requests to the backend, we considered:
1. A cross-site cookie issued by the backend (`SameSite=None; Secure`) — but this is increasingly unreliable due to browser third-party-cookie restrictions (Safari ITP, Chrome phase-out), and would fail unpredictably at exactly the login step.
2. An opaque session token returned in the login response body, stored client-side in `localStorage`, sent as `Authorization: Bearer <token>` on every request.

**Decision: option 2 (token in header).** The backend maps `token → { portalCookie, expiresAt }` in a server-side session store (not in-memory, since Vercel functions are stateless per-invocation — needs Vercel KV, Upstash Redis, or similar).

**Consequences:** backend needs a real session store from day one (can't defer to "just use memory for now"). No CSRF concerns from cookies, but the frontend is responsible for attaching the header on every call and clearing the token on logout/401.

**Session store: Vercel KV.** Chosen for zero extra setup since the backend already deploys to Vercel (no separate account/API key). Vercel KV is a rebrand of Upstash Redis, so migrating off it later (e.g. to raw Upstash or another host) is a low-effort env-var swap, not a rewrite.
