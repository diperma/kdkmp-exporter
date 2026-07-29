import type { Writable } from "node:stream";
import ExcelJS from "exceljs";
import type { ReportRow } from "./report.js";

/**
 * Exports are written straight to the response stream rather than built in
 * memory first: a full national export is ~18k rows, which comfortably exceeds
 * both the buffered-response ceiling on Vercel and any sensible memory budget
 * for a serverless function.
 *
 * `loadBatches` yields rows a province at a time, so nothing ever holds the
 * whole report at once.
 */
export type RowBatches = AsyncIterable<ReportRow[]>;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function streamCsv(
  out: Writable,
  columns: string[],
  batches: RowBatches,
): Promise<void> {
  // BOM so Excel opens UTF-8 (Indonesian names) correctly on Windows.
  write(out, "﻿" + columns.map(csvEscape).join(",") + "\r\n");

  for await (const batch of batches) {
    if (batch.length === 0) continue;
    const chunk = batch
      .map((row) => columns.map((column) => csvEscape(row[column])).join(","))
      .join("\r\n");
    await write(out, chunk + "\r\n");
  }
  out.end();
}

export async function streamXlsx(
  out: Writable,
  columns: string[],
  batches: RowBatches,
  sheetName: string,
): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true });
  // Excel rejects sheet names over 31 chars or containing []:*?/\
  // In streaming mode `views` is read-only on the worksheet, so the frozen
  // header has to be declared up front rather than assigned afterwards.
  const sheet = workbook.addWorksheet(sheetName.replace(/[[\]:*?/\\]/g, " ").slice(0, 31), {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = columns.map((column) => ({
    header: column,
    key: column,
    width: Math.min(40, Math.max(12, column.length + 4)),
  }));
  sheet.getRow(1).font = { bold: true };

  for await (const batch of batches) {
    for (const row of batch) sheet.addRow(row).commit();
  }

  sheet.commit();
  await workbook.commit();
}

/** Respects backpressure so a slow client can't balloon memory. */
function write(out: Writable, chunk: string): Promise<void> | void {
  if (out.write(chunk)) return;
  return new Promise<void>((resolve) => out.once("drain", () => resolve()));
}
