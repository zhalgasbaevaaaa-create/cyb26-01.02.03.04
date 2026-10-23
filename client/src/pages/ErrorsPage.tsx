import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { kz, REQUIREMENTS } from "@gha/shared";
import type { EvaluationRecord } from "@gha/shared";
import { EmptyState, Spinner, StatusBadge } from "../components/ui";

export default function ErrorsPage() {
  const [evals, setEvals] = useState<EvaluationRecord[] | null>(null);

  useEffect(() => {
    api.get<{ evaluations: EvaluationRecord[] }>("/api/audits")
      .then((d) => setEvals(d.evaluations))
      .catch(() => setEvals([]));
  }, []);

  const problems = useMemo(() => {
    if (!evals) return [];
    const items: { rec: EvaluationRecord; testName: string; reqId: string; status: "FAIL" | "PARTIAL"; actual: string }[] = [];
    for (const rec of evals) {
      for (const t of rec.tests) {
        if (t.status === "FAIL" || t.status === "PARTIAL") {
          items.push({ rec, testName: t.name, reqId: t.requirementId, status: t.status, actual: t.actual });
        }
      }
    }
    return items.sort((a, b) => (a.status === b.status ? 0 : a.status === "FAIL" ? -1 : 1));
  }, [evals]);

  if (!evals) return <Spinner />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gold">{kz.nav.errors}</h1>
      {problems.length === 0 ? (
        <EmptyState text={kz.common.empty} />
      ) : (
        <div className="space-y-3">
          {problems.map((p, i) => (
            <div key={i} className="card">
              <div className="flex justify-between flex-wrap gap-2 items-start">
                <div>
                  <Link to={`/results/${p.rec.id}`} className="text-blue-400 text-sm">
                    {p.rec.studentName} ({p.rec.groupName}) — {p.rec.assignmentId}
                  </Link>
                  <div className="font-medium mt-1">{p.testName}</div>
                  <div className="text-xs text-gray-500">
                    {REQUIREMENTS.find((r) => r.id === p.reqId)?.displayText ?? p.reqId}
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </div>
              <p className="text-sm text-gray-300 mt-2">{p.actual}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
