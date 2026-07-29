# Never persist the user's portalkdkmp.id password

The backend logs in to `portalkdkmp.id` on the user's behalf (ADR-pending "server-side login proxy" in CLAUDE.md) and better-auth sessions expire/rotate over time, so the system will eventually see 401s from `portalkdkmp.id` mid-session.

Two ways to handle that:
1. Store the user's real portalkdkmp.id password (encrypted) so the backend can silently re-login on 401.
2. Never persist the password past the initial login call — discard it from memory immediately after exchanging it for a session cookie. On a later 401, surface a re-login prompt instead of retrying automatically.

**Decision: option 2.** This tool is public-facing (anyone with a portalkdkmp.id account, likely government/BPKP staff, can use it), so the security cost of custodying real user credentials — even encrypted — outweighs the UX cost of an occasional manual re-login. The session token issued to the frontend (ADR-0001) and the portalkdkmp.id cookie it maps to in Vercel KV are the only things persisted; the password itself only ever exists transiently in the login request handler.

**Consequences:** no silent re-login on session expiry — a 401 from `portalkdkmp.id` must bubble up as "please log in again," not be retried automatically. This must be handled explicitly wherever the fetch layer calls `portalkdkmp.id` (isolate this in the one fetch-wrapper function per CLAUDE.md's suggested build approach, so the 401→relogin-prompt behavior is written once).
