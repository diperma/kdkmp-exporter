# Background job (Upstash QStash) for the Mandatory-Complete detail report

The "Mandatory-Complete + per-item breakdown" report (Sarpras Completion Tier, see `CONTEXT.md`) needs `laporanVendor.getCompleteMonitor` called once per province that has any Mandatory-Complete koperasi (5 provinces as of 2026-07-28: Jawa Tengah, Jawa Timur, Jawa Barat, Banten, DKI Jakarta). Measured live: one province call (Jawa Tengah) took ~4.1s and returned ~11.2MB, because the endpoint returns every koperasi in the province with full `sarprasReports` detail — there's no server-side filter to narrow it to just Mandatory-Complete koperasi.

Running all 5 calls within a single Vercel serverless invocation risks exceeding the platform's default function timeout (10s on Hobby), especially sequential, and parallel isn't guaranteed safe either if one province is slow.

**Decision: process this report as a background job**, not a single request/response:
1. An API route enqueues one job step per province via Upstash QStash (chosen over a DIY self-chaining `fetch` because QStash gives automatic retry/backoff per step and a dashboard for visibility — same Upstash account already in use for the KV session store from ADR-0001, so no new vendor).
2. Each QStash-invoked step fetches one province's `getCompleteMonitor`, filters to Mandatory-Complete koperasi, and appends the result into the job's record in Vercel KV.
3. Frontend polls a status endpoint for job progress (e.g. "3/5 provinces done") and fetches/downloads the assembled XLSX/CSV once all steps report complete.

**Consequences:** adds Upstash QStash as a dependency (env var + one more account setup, but same ecosystem as KV). Report generation is no longer instant — user sees a progress state, not an immediate download. This pattern is the template for any other report that needs multiple heavy per-region/per-koperasi calls; the lightweight single-fetch reports (e.g. the base Mandatory-Complete list without per-item breakdown) don't need this and stay synchronous.
