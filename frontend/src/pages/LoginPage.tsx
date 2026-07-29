import { useState, type FormEvent } from "react";
import { login } from "../lib/api.js";
import { saveSession } from "../lib/session.js";

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login(username.trim(), password);
      saveSession(result.token, result.username);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card--narrow">
      <h1>Masuk</h1>
      <p className="muted">
        Gunakan akun portalkdkmp.id Anda. Kata sandi dipakai sekali untuk membuka sesi dan
        tidak pernah disimpan.
      </p>

      <form onSubmit={handleSubmit}>
        <label htmlFor="username">No. HP / Username</label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />

        <label htmlFor="password">Kata Sandi</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={busy}>
          {busy ? "Menghubungkan…" : "Masuk"}
        </button>
      </form>
    </div>
  );
}
