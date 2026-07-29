/**
 * Our backend session token, kept in localStorage.
 *
 * Frontend (GitHub Pages) and backend (Vercel) are different origins, so the
 * token travels in an Authorization header rather than a cookie — see ADR-0001.
 */
const TOKEN_KEY = "kdkmp.token";
const USERNAME_KEY = "kdkmp.username";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUsername(): string | null {
  return localStorage.getItem(USERNAME_KEY);
}

export function saveSession(token: string, username: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USERNAME_KEY, username);
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USERNAME_KEY);
}
