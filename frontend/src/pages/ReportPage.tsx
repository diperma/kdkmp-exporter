import { useEffect, useRef, useState } from "react";
import {
  downloadReport,
  getReportStatus,
  runProvince,
  startReport,
  SessionExpiredError,
  type JobStatus,
} from "../lib/api.js";

/**
 * Matches the portal's own legend. Membership always comes from the portal
 * (ADR-0004). `heavy` marks the scopes that span most of the country and take
 * minutes rather than seconds, so the user isn't surprised by the wait.
 */
const SCOPES = [
  { value: "all", label: "Semua kategori — seluruh data", heavy: true },
  { value: "mandatory_complete", label: "Primary lengkap (Hijau)", heavy: false },
  { value: "below_10", label: "Sarpras di bawah 10 (Merah)", heavy: true },
  { value: "partial", label: "Sarpras 10+ belum lengkap (Kuning)", heavy: false },
  { value: "secondary_complete", label: "Secondary lengkap (Oranye)", heavy: false },
  { value: "complete_all", label: "Semua sarpras lengkap (Biru)", heavy: false },
];

const POLL_INTERVAL_MS = 2500;

export function ReportPage({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [scope, setScope] = useState(SCOPES[0]!.value);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function handleError(err: unknown) {
    if (err instanceof SessionExpiredError) {
      onSessionExpired();
      return;
    }
    setError(err instanceof Error ? err.message : "Terjadi kesalahan.");
  }

  /**
   * Local mode: the backend has no queue, so we walk the provinces ourselves,
   * refreshing the progress view after each one lands.
   */
  async function driveInline(id: string, provinceIds: string[]) {
    for (const provinceId of provinceIds) {
      try {
        await runProvince(id, provinceId);
      } catch (err) {
        handleError(err);
        if (err instanceof SessionExpiredError) return;
      }
      try {
        setStatus(await getReportStatus(id));
      } catch (err) {
        handleError(err);
        return;
      }
    }
  }

  async function poll(id: string) {
    try {
      const next = await getReportStatus(id);
      setStatus(next);
      if (next.status === "running") {
        timer.current = window.setTimeout(() => void poll(id), POLL_INTERVAL_MS);
      }
    } catch (err) {
      handleError(err);
    }
  }

  async function handleStart() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setStatus(null);
    setJobId(null);
    try {
      const result = await startReport(scope);
      if (!result.jobId) {
        setNotice(result.message ?? "Tidak ada data untuk kategori ini.");
        return;
      }
      const notes: string[] = [];
      if (result.mode === "inline") {
        notes.push("Mode lokal: langkah dijalankan langsung oleh backend, tanpa antrian.");
      }
      if (result.skippedProvinces?.length) {
        notes.push(`Provinsi dilewati (tidak cocok): ${result.skippedProvinces.join(", ")}`);
      }
      if (notes.length) setNotice(notes.join(" "));
      setJobId(result.jobId);
      setStatus(await getReportStatus(result.jobId));

      if (result.mode === "inline") {
        void driveInline(
          result.jobId,
          result.provinces.map((province) => province.id),
        );
      } else {
        void poll(result.jobId);
      }
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(format: "xlsx" | "csv") {
    if (!jobId) return;
    try {
      await downloadReport(jobId, format);
    } catch (err) {
      handleError(err);
    }
  }

  const done = status?.status === "complete";
  const failed = status?.status === "failed";
  const isHeavy = SCOPES.find((option) => option.value === scope)?.heavy ?? false;
  const rowsSoFar = (status?.provinces ?? [])
    .filter((province) => province.done && !province.error)
    .reduce((sum, province) => sum + province.expected, 0);

  return (
    <div className="card">
      <h1>Laporan Kelengkapan Sarpras</h1>
      <p className="muted">
        Menarik daftar koperasi pada kategori kelengkapan tertentu, lengkap dengan status
        dan vendor tiap item Mandatory. Kategori diambil langsung dari klasifikasi portal,
        bukan dihitung ulang.
      </p>

      <div className="row">
        <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={busy}>
          {SCOPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button onClick={() => void handleStart()} disabled={busy}>
          {busy ? "Memulai…" : "Buat Laporan"}
        </button>
      </div>

      {isHeavy && !status && (
        <p className="muted small">
          Kategori ini mencakup hampir seluruh provinsi — penarikan memakan waktu beberapa
          menit. Biarkan halaman ini terbuka sampai selesai.
        </p>
      )}

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {status && (
        <div className="progress">
          <p>
            <strong>
              {status.progress.done} / {status.progress.total} provinsi selesai
            </strong>{" "}
            — {rowsSoFar.toLocaleString("id-ID")} dari{" "}
            {status.totalExpected.toLocaleString("id-ID")} koperasi
          </p>
          <ul className="province-list">
            {status.provinces.map((province) => (
              <li key={province.id}>
                <span className={province.done ? "dot dot--done" : "dot"} />
                {province.label} ({province.expected.toLocaleString("id-ID")})
                {province.error && <span className="error"> — {province.error}</span>}
              </li>
            ))}
          </ul>
          {failed && <p className="error">{status.error ?? "Job gagal."}</p>}
        </div>
      )}

      {(done || failed) && (
        <div className="row">
          <button onClick={() => void handleDownload("xlsx")}>Unduh XLSX</button>
          <button className="secondary" onClick={() => void handleDownload("csv")}>
            Unduh CSV
          </button>
        </div>
      )}
    </div>
  );
}
