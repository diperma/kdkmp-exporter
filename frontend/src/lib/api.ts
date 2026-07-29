import { clearSession, getToken } from "./session.js";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

/** The backend says our session is gone; the user has to log in again (ADR-0003). */
export class SessionExpiredError extends Error {
  constructor(message = "Sesi berakhir. Silakan login ulang.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

export class ApiError extends Error {}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401) {
    clearSession();
    const body = await res.json().catch(() => null);
    throw new SessionExpiredError(body?.message);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.message ?? `Permintaan gagal (HTTP ${res.status})`);
  }
  return res;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return (await request(path, init)).json() as Promise<T>;
}

export interface LoginResult {
  token: string;
  username: string;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  // Sent once and never stored anywhere — the backend discards it after
  // exchanging it for a portal session (ADR-0003).
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.message ?? "Login gagal.");
  return body as LoginResult;
}

export async function logout(): Promise<void> {
  await request("/api/auth/session", { method: "POST" }).catch(() => undefined);
  clearSession();
}

export interface StartJobResult {
  jobId: string | null;
  totalExpected: number;
  provinces: { id: string; label: string; expected: number }[];
  skippedProvinces?: string[];
  message?: string;
  /** "inline" means the backend ran the steps itself (local dev, no queue). */
  mode?: "inline" | "queued";
}

export interface ProvinceSummary {
  label: string;
  total: number;
  counts: Record<string, number>;
}

export interface CompletionSummary {
  total: number;
  counts: Record<string, number>;
  byProvince: ProvinceSummary[];
  computedAt: number;
}

/** Read-only tier counts for the dashboard cards — never creates a job. */
export function getCompletionSummary(): Promise<CompletionSummary> {
  return json<CompletionSummary>("/api/reports/completion/summary");
}

export function startReport(scope: string): Promise<StartJobResult> {
  return json<StartJobResult>("/api/reports/completion/start", {
    method: "POST",
    body: JSON.stringify({ scope }),
  });
}

export interface JobStatus {
  jobId: string;
  scope: string;
  status: "running" | "complete" | "failed";
  error?: string;
  progress: { done: number; total: number };
  totalExpected: number;
  provinces: { id: string; label: string; expected: number; done: boolean; error?: string }[];
}

/**
 * Local mode only: runs one province and waits for it. In production QStash
 * does this out of band, so the client just polls instead.
 */
export function runProvince(jobId: string, provinceId: string): Promise<unknown> {
  return json("/api/reports/completion/run", {
    method: "POST",
    body: JSON.stringify({ jobId, provinceId }),
  });
}

export function getReportStatus(jobId: string): Promise<JobStatus> {
  return json<JobStatus>(
    `/api/reports/completion/status?jobId=${encodeURIComponent(jobId)}`,
  );
}

/** Downloads through fetch (not a plain link) so the auth header can be attached. */
export async function downloadReport(jobId: string, format: "xlsx" | "csv"): Promise<void> {
  const res = await request(
    `/api/reports/completion/download?jobId=${encodeURIComponent(jobId)}&format=${format}`,
  );
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? `kdkmp.${format}`;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
