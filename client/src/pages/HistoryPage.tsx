import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { kz, buildCsv, CSV_HEADERS } from "@gha/shared";
import type { EvaluationRecord } from "@gha/shared";
import { EmptyState, JobStatusBadge, Spinner } from "../components/ui";

type SortKey = "createdAt" | "studentName" | "provisionalScore";

export default function HistoryPage() {
  const [evals, setEvals] = useState<EvaluationRecord[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [assignmentFilter, setAssignmentFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    api.get<{ evaluations: EvaluationRecord[] }>("/api/audits")
      .then((d) => setEvals(d.evaluations))
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
    if (statusFilter) list = list.filter((e) => e.status === statusFilter);
    if (assignmentFilter) list = list.filter((e) => e.assignmentId === assignmentFilter);
    list.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [evals, query, statusFilter, assignmentFilter, sortKey, sortDir]);

  function exportCsv() {
    const rows = filtered.map((e) => [
      e.id, e.studentName, e.groupName, e.projectUrl, e.repositoryUrl ?? "", e.assignmentId,
      new Date(e.createdAt).toLocaleString("kk-KZ"), kz.status[e.status],
      e.totalScore, e.provisionalScore,
      Math.round(e.verificationCoverage * 100), Math.round(e.evidenceConfidence * 100),
      e.rubricVersion,
    ]);
    const blob = new Blob([buildCsv([...CSV_HEADERS.history], rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tekseru-tarihy.csv";
    a.click();
    URL.revokeObjectURL(url);
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

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-gold">{kz.nav.history}</h1>
        <button className="btn-secondary" onClick={exportCsv} disabled={filtered.length === 0}>
          {kz.reports.downloadCsv}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder={kz.form.search} value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="input max-w-[180px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">{kz.form.filter}: —</option>
          {Object.entries(kz.status).filter(([k]) => ["queued", "running", "completed", "failed", "blocked", "cancelled"].includes(k)).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select className="input max-w-[180px]" value={assignmentFilter} onChange={(e) => setAssignmentFilter(e.target.value)}>
          <option value="">A1–A6: —</option>
          {["A1", "A2", "A3", "A4", "A5", "A6"].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState text={kz.common.empty} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-700">
                {header("createdAt", kz.common.date)}
                {header("studentName", kz.common.student)}
                <th className="py-2 pr-3">{kz.common.group}</th>
                <th className="py-2 pr-3">{kz.common.assignment}</th>
                <th className="py-2 pr-3">{kz.status.progress}</th>
                {header("provisionalScore", kz.score.provisional)}
                <th className="py-2 pr-3">{kz.score.verificationCoverage}</th>
                <th className="py-2">{kz.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-gray-800 hover:bg-darkbg/60">
                  <td className="py-2 pr-3 whitespace-nowrap">{new Date(e.createdAt).toLocaleString("kk-KZ")}</td>
                  <td className="py-2 pr-3">{e.studentName}</td>
                  <td className="py-2 pr-3">{e.groupName}</td>
                  <td className="py-2 pr-3">{e.assignmentId}</td>
                  <td className="py-2 pr-3"><JobStatusBadge status={e.status} /></td>
                  <td className="py-2 pr-3 font-semibold">
                    {["completed", "blocked"].includes(e.status) ? `${e.provisionalScore}/100` : "—"}
                  </td>
                  <td className="py-2 pr-3">{Math.round(e.verificationCoverage * 100)}%</td>
                  <td className="py-2">
                    <Link className="text-blue-400" to={`/results/${e.id}`}>{kz.common.details}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
