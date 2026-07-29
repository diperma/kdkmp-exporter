import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  applyCors,
  handledPreflight,
  requireSession,
  sendError,
} from "../../../lib/http.js";
import { streamCsv, streamXlsx, type RowBatches } from "../../../lib/export.js";
import {
  readJob,
  readProvinceRows,
  SCOPE_LABELS,
  summariseJob,
  type JobSummary,
} from "../../../lib/report.js";

/**
 * Streams the finished report as XLSX (default) or CSV.
 *
 * Rows are pulled from KV a province at a time and written straight out — a
 * full national export is ~18k rows, too big to buffer into a single response
 * body on Vercel.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
  if (handledPreflight(req, res)) return;

  try {
    const authed = await requireSession(req, res);
    if (!authed) return;

    const jobId = typeof req.query.jobId === "string" ? req.query.jobId : "";
    const format = req.query.format === "csv" ? "csv" : "xlsx";
    if (!jobId) return res.status(400).json({ error: "bad_request", message: "jobId wajib." });

    const meta = await readJob(jobId);
    if (!meta) return res.status(404).json({ error: "job_not_found" });
    if (meta.sessionToken !== authed.token) return res.status(403).json({ error: "forbidden" });
    const summary = await summariseJob(meta);
    if (summary.status === "running") {
      return res.status(409).json({ error: "not_ready", message: "Job masih berjalan." });
    }

    const filename = `Data_Koperasi_dan_Sarpras_${jakartaTimestamp()}.${format}`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      await streamCsv(res, meta.columns, provinceBatches(meta.id, summary));
      return;
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    await streamXlsx(
      res,
      meta.columns,
      provinceBatches(meta.id, summary),
      SCOPE_LABELS[meta.scope] ?? meta.scope,
    );
  } catch (err) {
    // Once streaming has begun the status line is already sent; all we can do
    // is cut the response so the client sees a truncated download rather than a
    // silently incomplete file.
    if (res.headersSent) {
      console.error("Gagal di tengah streaming export:", err);
      res.end();
      return;
    }
    return sendError(res, err);
  }
}

async function* provinceBatches(jobId: string, summary: JobSummary): RowBatches {
  for (const province of summary.provinces) {
    yield await readProvinceRows(jobId, province.id, province.rowChunks ?? 0);
  }
}

/**
 * `YYYY-MM-DD_HHMM` in WIB (Asia/Jakarta), matching the audience — not UTC.
 * Deliberately doesn't include the scope: downloading two different
 * categories in the same minute will collide on filename, but the browser's
 * own "(1)" suffixing on repeat downloads already handles that.
 */
function jakartaTimestamp(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}${parts.minute}`;
}
