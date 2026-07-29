# Delete job data immediately after download, not just on TTL

ADR-0006 shrank the job TTL to 3h after leftover test data exhausted the free Upstash plan's 256MB quota. The quota was hit again in normal use shortly after — a TTL-only cleanup still lets several national-scope jobs (~15-20MB each) accumulate within any given window before they expire.

**Decision:** `download.ts` calls `deleteJob()` right after a download finishes streaming successfully, removing the job's meta, per-province done markers, and every row/point chunk from KV. This frees the space within seconds of actual use instead of waiting on a timer, and doesn't depend on guessing a TTL short enough to bound accumulation but long enough to never race a legitimately slow job.

The TTL (`JOB_TTL_SECONDS`, now 60 min) still exists as a safety net for jobs that are created but never downloaded — it deliberately stays well above worst-case job duration (QStash retries with backoff have taken several minutes under contention), because a TTL shorter than that would let a slow job's early-written `points` chunks expire before its last province finishes processing, silently producing zero rows for that province rather than an error.

**Consequences:** downloading both XLSX and CSV of the same job no longer works from one job — the first download's cleanup deletes the data the second format needs, so the second requires regenerating the job. Acceptable since regeneration is fast (seconds to a few minutes depending on scope) and the alternative (keeping data alive "just in case" of a second download) is exactly the accumulation this change exists to prevent. A cleanup failure is logged, not surfaced as an error, so it never turns an already-successful download into a failed response.
