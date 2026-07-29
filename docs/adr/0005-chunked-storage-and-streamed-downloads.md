# Chunked KV storage and streamed downloads

Adding the "Merah" (`below_10`, 16,411 koperasi) and "Semua kategori" (17,922) scopes took the exporter roughly 15× past what the original Hijau-only report handled (1,148 koperasi across 5 provinces). Two platform ceilings sit right in that range:

- **Upstash KV caps a value at 1MB per command.** A single province's rows can exceed that on its own — Jawa Tengah alone holds ~4,700 koperasi.
- **Vercel caps a buffered serverless response at 4.5MB.** Measured at 363 rows, a full 17,922-row export extrapolates to ~7MB CSV and ~4MB XLSX — over the line for CSV and uncomfortably close for XLSX.

**Decision:**
1. Rows and input points are written to KV in fixed-size slices (400 rows / 800 points per key), with the slice count recorded on the job's province record so readers know how many keys to fetch.
2. Downloads are written straight to the response as a stream, pulling rows from KV one province at a time. Nothing ever holds the full report in memory, and the response is never buffered.

3. Per-province completion is written to its own key (`job:{id}:done:{provinceId}`) and job status is *derived* by reading those keys, never stored as a single mutable field. Under QStash the ~30 steps run concurrently; a read-modify-write of one shared job record would let two steps finishing at the same moment overwrite each other, reverting a province to unfinished with no step left to redo it — a job that hangs forever. This failure mode is invisible in local development, where steps run one at a time.

**Consequences:** the download handler can fail *after* the response has started, at which point the status line is already sent and all it can do is cut the stream — the client sees a truncated file rather than a clean error. That failure mode is logged server-side. Also note ExcelJS's streaming `WorksheetWriter` is not API-compatible with the in-memory `Worksheet`: `views` is read-only and must be passed to `addWorksheet`, which cost us a silently truncated 49-byte xlsx before it was caught.
