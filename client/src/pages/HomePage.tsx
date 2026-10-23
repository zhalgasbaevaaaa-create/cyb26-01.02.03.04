import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { kz } from "@gha/shared";
import type { EvaluationRecord } from "@gha/shared";
import { Spinner } from "../components/ui";

export default function HomePage() {
  const [evals, setEvals] = useState<EvaluationRecord[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<{ evaluations: EvaluationRecord[] }>("/api/audits")
      .then((d) => setEvals(d.evaluations))
      .catch((e) => setError(e.message));
  }, []);

  const completed = evals?.filter((e) => e.status === "completed") ?? [];
  const avg = completed.length ? Math.round((completed.reduce((s, e) => s + e.provisionalScore, 0) / completed.length) * 10) / 10 : 0;
  const blocked = evals?.filter((e) => e.status === "blocked" || e.status === "failed").length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gold">{kz.home.welcome}</h1>
        <p className="text-gray-300 mt-2 max-w-3xl">{kz.home.description}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={kz.home.stats.totalAudits} value={evals ? String(evals.length) : "…"} />
        <Stat label={kz.home.stats.completed} value={String(completed.length)} />
        <Stat label={kz.home.stats.averageScore} value={completed.length ? String(avg) : "—"} />
        <Stat label={kz.home.stats.blocked} value={String(blocked)} />
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {!evals && !error && <Spinner />}

      <div className="card">
        <h2 className="font-semibold mb-3">{kz.home.quickStart}</h2>
        <ol className="list-decimal pl-5 space-y-1 text-sm text-gray-300">
          <li>{kz.home.step1.replace(/^\d-қадам: /, "")}</li>
          <li>{kz.home.step2.replace(/^\d-қадам: /, "")}</li>
          <li>{kz.home.step3.replace(/^\d-қадам: /, "")}</li>
        </ol>
        <Link to="/new" className="btn-primary mt-4">{kz.nav.newAudit} →</Link>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
