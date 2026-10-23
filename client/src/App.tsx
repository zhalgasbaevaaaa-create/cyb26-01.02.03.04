import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { api, clearToken, getToken, setToken } from "./api";
import { kz } from "@gha/shared";
import HomePage from "./pages/HomePage";
import NewAuditPage from "./pages/NewAuditPage";
import AssignmentsPage from "./pages/AssignmentsPage";
import HistoryPage from "./pages/HistoryPage";
import ResultPage from "./pages/ResultPage";
import ErrorsPage from "./pages/ErrorsPage";
import ReportsPage from "./pages/ReportsPage";
import RubricPage from "./pages/RubricPage";
import SettingsPage from "./pages/SettingsPage";

function LoginGate({ onLogin }: { onLogin: () => void }) {
  const [token, setTok] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/api/auth/login", { token });
      setToken(token);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : kz.common.loginError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <h1 className="text-xl font-bold text-gold">{kz.app.name}</h1>
        <h2 className="text-lg font-semibold">{kz.common.loginTitle}</h2>
        <p className="text-sm text-gray-400">{kz.common.loginHint}</p>
        <div>
          <label className="label">{kz.common.loginToken}</label>
          <input className="input" type="password" value={token} onChange={(e) => setTok(e.target.value)} autoFocus />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="btn-primary w-full justify-center" disabled={busy || !token}>
          {busy ? kz.common.loading : kz.common.loginButton}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => !!getToken());
  const navigate = useNavigate();

  useEffect(() => {
    // 401 болса — кіру бетіне оралу
    const handler = () => { setAuthed(false); };
    window.addEventListener("gha:unauthorized", handler);
    return () => window.removeEventListener("gha:unauthorized", handler);
  }, []);

  if (!authed) return <LoginGate onLogin={() => setAuthed(true)} />;

  const links = [
    { to: "/", label: kz.nav.home },
    { to: "/new", label: kz.nav.newAudit },
    { to: "/assignments", label: kz.nav.assignments },
    { to: "/history", label: kz.nav.history },
    { to: "/results", label: kz.nav.results },
    { to: "/errors", label: kz.nav.errors },
    { to: "/reports", label: kz.nav.reports },
    { to: "/rubric", label: kz.nav.rubric },
    { to: "/settings", label: kz.nav.settings },
  ];

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="md:w-64 bg-panel md:min-h-screen p-4 flex md:flex-col gap-1 overflow-x-auto">
        <div className="hidden md:block mb-4">
          <div className="text-gold font-bold leading-tight">{kz.app.name}</div>
          <div className="text-xs text-gray-400 mt-1">{kz.app.subtitle}</div>
        </div>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.to === "/"} className={({ isActive }) => `navlink whitespace-nowrap ${isActive ? "navlink-active" : ""}`}>
            {l.label}
          </NavLink>
        ))}
        <button
          className="navlink whitespace-nowrap mt-auto text-red-300"
          onClick={() => { clearToken(); setAuthed(false); navigate("/"); }}
        >
          {kz.common.logout}
        </button>
      </aside>
      <main className="flex-1 p-4 md:p-6 max-w-6xl w-full mx-auto">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/new" element={<NewAuditPage />} />
          <Route path="/assignments" element={<AssignmentsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/results" element={<HistoryPage />} />
          <Route path="/results/:id" element={<ResultPage />} />
          <Route path="/errors" element={<ErrorsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/rubric" element={<RubricPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
