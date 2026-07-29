import { useState } from "react";
import { LoginPage } from "./pages/LoginPage.js";
import { ReportPage } from "./pages/ReportPage.js";
import { logout } from "./lib/api.js";
import { clearSession, getToken, getUsername } from "./lib/session.js";

export function App() {
  const [token, setToken] = useState<string | null>(getToken());
  const [expiredNotice, setExpiredNotice] = useState(false);

  function handleSessionExpired() {
    clearSession();
    setToken(null);
    setExpiredNotice(true);
  }

  if (!token) {
    return (
      <main>
        {expiredNotice && (
          <p className="notice notice--top">Sesi berakhir. Silakan masuk kembali.</p>
        )}
        <LoginPage
          onLoggedIn={() => {
            setExpiredNotice(false);
            setToken(getToken());
          }}
        />
      </main>
    );
  }

  return (
    <main>
      <header className="topbar">
        <span className="muted">Masuk sebagai {getUsername()}</span>
        <button
          className="link"
          onClick={async () => {
            await logout();
            setToken(null);
          }}
        >
          Keluar
        </button>
      </header>
      <ReportPage onSessionExpired={handleSessionExpired} />
    </main>
  );
}
