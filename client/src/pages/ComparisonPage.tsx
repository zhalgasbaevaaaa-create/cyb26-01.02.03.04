import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { kz, CRITERION_LABELS } from "@gha/shared";
import type { EvaluationRecord, CriterionKey } from "@gha/shared";
import { EmptyState, JobStatusBadge, Spinner } from "../components/ui";

type SortKey = "createdAt" | "studentName" | "groupName" | "assignmentId" | "provisionalScore";

export default function ComparisonPage() {
  const [evals, setEvals] = useState<EvaluationRecord[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.get<{ evaluations: EvaluationRecord[] }>("/api/audits")
      .then((d) => setEvals(d.evaluations.filter((e) => e.status === "completed" || e.status === "blocked")))
      .catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    if (!evals) return [];
    let list = [...evals];
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((e) =>
        [e.studentName, e.groupName, e.projectUrl, e.assignmentId].some((v) => v.toLowerCase().includes(q)));
    }
    list.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [evals, query, sortKey, sortDir]);

  const selectedRecords = useMemo(
    () => (evals ?? []).filter((e) => selected.has(e.id)),
    [evals, selected],
  );

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function header(key: SortKey, label: string) {
    return (
      <th
        className="py-2 pr-3 cursor-pointer select-none hover:text-white"
        onClick={() => {
          if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
          else { setSortKey(key); setSortDir("desc"); }
        }}
      >
        {label} {sortKey === key ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </th>
    );
  }

  if (error) return <p className="text-red-400">{error}</p>;
  if (!evals) return <Spinner />;

  const allCriteriaKeys: CriterionKey[] = selectedRecords.length
    ? (selectedRecords[0].criteria.map((c) => c.key) as CriterionKey[])
    : [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gold">{kz.comparison.title}</h1>
        <p className="text-sm text-gray-400">{kz.comparison.subtitle}</p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input className="input max-w-xs" placeholder={kz.form.search} value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="text-sm text-gray-400">{kz.comparison.selected}: {selected.size}</span>
        {selected.size > 0 && (
          <button className="btn-secondary" onClick={() => setSelected(new Set())}>{kz.comparison.clearSelection}</button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState text={kz.common.empty} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-700">
                <th className="py-2 pr-3"></th>
                {header("createdAt", kz.common.date)}
                {header("studentName", kz.common.student)}
                {header("groupName", kz.common.group)}
                {header("assignmentId", kz.common.assignment)}
                {header("provisionalScore", kz.score.provisional)}
                <th className="py-2 pr-3">{kz.status.completed}</th>
                <th className="py-2">{kz.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className={`border-b border-gray-800 hover:bg-darkbg/60 ${selected.has(e.id) ? "bg-darkbg/40" : ""}`}>
                  <td className="py-2 pr-3">
                    <input type="checkbox" className="w-4 h-4 accent-gold" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">{new Date(e.createdAt).toLocaleString("kk-KZ")}</td>
                  <td className="py-2 pr-3">{e.studentName}</td>
                  <td className="py-2 pr-3">{e.groupName}</td>
                  <td className="py-2 pr-3">{e.assignmentId}</td>
                  <td className="py-2 pr-3 font-semibold">{e.provisionalScore}/100</td>
                  <td className="py-2 pr-3"><JobStatusBadge status={e.status} /></td>
                  <td className="py-2">
                    <Link className="text-blue-400" to={`/results/${e.id}`}>{kz.common.details}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2 className="font-semibold mb-3">{kz.comparison.comparisonTable}</h2>
        {selectedRecords.length < 2 ? (
          <p className="text-gray-400 text-sm">{kz.comparison.noSelection}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="py-2 pr-3">{kz.score.criteria}</th>
                  {selectedRecords.map((e) => (
                    <th key={e.id} className="py-2 pr-3 whitespace-nowrap">
                      {e.studentName}
                      <div className="text-xs font-normal text-gray-500">{e.groupName} · {e.assignmentId}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-800 font-bold">
                  <td className="py-2 pr-3">{kz.score.total}</td>
                  {selectedRecords.map((e) => <td key={e.id} className="py-2 pr-3">{e.totalScore}</td>)}
                </tr>
                <tr className="border-b border-gray-800 font-bold text-gold">
                  <td className="py-2 pr-3">{kz.score.provisional}</td>
                  {selectedRecords.map((e) => <td key={e.id} className="py-2 pr-3">{e.provisionalScore}/100</td>)}
                </tr>
                <tr className="border-b border-gray-800">
                  <td className="py-2 pr-3">{kz.score.verificationCoverage}</td>
                  {selectedRecords.map((e) => <td key={e.id} className="py-2 pr-3">{Math.round(e.verificationCoverage * 100)}%</td>)}
                </tr>
                {allCriteriaKeys.map((key) => (
                  <tr key={key} className="border-b border-gray-800">
                    <td className="py-2 pr-3">{CRITERION_LABELS[key]}</td>
                    {selectedRecords.map((e) => {
                      const c = e.criteria.find((cc) => cc.key === key);
                      return (
                        <td key={e.id} className={`py-2 pr-3 ${c?.verified ? "" : "text-gray-500"}`}>
                          {c ? `${c.earnedPoints}/${c.maxPoints}${!c.verified ? " *" : ""}` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {selectedRecords.some((e) => e.criticalFailures.length > 0) && (
                  <tr>
                    <td className="py-2 pr-3 text-red-400">{kz.critical.title}</td>
                    {selectedRecords.map((e) => (
                      <td key={e.id} className="py-2 pr-3 text-red-300 text-xs">
                        {e.criticalFailures.length === 0 ? "—" : e.criticalFailures.map((cf) => cf.message).join("; ")}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
            <p className="text-xs text-gray-500 mt-2">* — критерий тексерілмеді: ұпай берілмеді де, нөл де қойылмады.</p>
          </div>
        )}
      </div>
    </div>
  );
}
