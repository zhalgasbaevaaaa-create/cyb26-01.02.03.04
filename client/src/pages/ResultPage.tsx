import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, fetchBlob, getToken } from "../api";
import { kz, REQUIREMENTS, scoringStatement } from "@gha/shared";
import type { EvaluationRecord, TestStatus } from "@gha/shared";
import { DownloadButton, JobStatusBadge, Spinner, StatusBadge, ErrorBox } from "../components/ui";

const CRITERION_LABELS: Record<string, string> = {
  compliance: "Тапсырмаға сәйкестік және ойынның толықтығы",
  mechanics: "Негізгі ойын механикасы және кезеңдер",
  history_tasks: "Тарихи тапсырмалар және міндетті тапсырма форматтары",
  auth_profile: "Аутентификация, профиль және сақталған нәтижелер",
  gamehub: "GAME HUB порталы және рейтинг жүйесі",
  backend_security: "Backend жүзеге асырылуы және қауіпсіздік",
  ui_responsive: "Пайдаланушы интерфейсі және адаптивті дизайн",
  history_accuracy: "Тарихи контенттің дәлдігі",
  code_quality: "Код сапасы, тестілеу және презентацияға дайындық",
};

function reqText(id: string): string {
  return REQUIREMENTS.find((r) => r.id === id)?.displayText ?? id;
}

export default function ResultPage() {
  const { id } = useParams<{ id: string }>();
  const [rec, setRec] = useState<EvaluationRecord | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<EvaluationRecord>(`/api/audits/${id}`);
      setRec(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : kz.common.error);
    }
  }, [id]);

  useEffect(() => {
    void load();
    pollRef.current = window.setInterval(async () => {
      try {
        const data = await api.get<EvaluationRecord>(`/api/audits/${id}`);
        setRec((prev) => {
          const active = prev ? ["queued", "running"].includes(prev.status) : true;
          if (active || !prev) void 0;
          return data;
        });
        if (!["queued", "running"].includes(data.status) && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch { /* желі қатесі — келесі сайлауда қайталаймыз */ }
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [id, load]);

  if (error) return <ErrorBox message={error} />;
  if (!rec) return <Spinner />;

  const active = ["queued", "running"].includes(rec.status);

  async function cancel() {
    setBusy("cancel");
    try {
      await api.post(`/api/audits/${rec!.id}/cancel`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : kz.common.error);
    } finally {
      setBusy("");
    }
  }

  async function retest() {
    setBusy("retest");
    try {
      const res = await api.post<{ id: string }>(`/api/audits/${rec!.id}/retest`);
      window.location.href = `/results/${res.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : kz.common.error);
      setBusy("");
    }
  }

  const groups: { key: TestStatus; title: string }[] = [
    { key: "PASS", title: kz.report.passedTests },
    { key: "FAIL", title: kz.report.failedTests },
    { key: "PARTIAL", title: kz.report.partialRequirements },
    { key: "NOT_VERIFIED", title: kz.test.NOT_VERIFIED },
    { key: "BLOCKED", title: kz.test.BLOCKED },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <Link to="/history" className="text-sm text-blue-400">← {kz.common.back}</Link>
          <h1 className="text-2xl font-bold text-gold mt-1">{rec.studentName} — {rec.groupName}</h1>
          <a href={rec.projectUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-400 break-all">{rec.projectUrl}</a>
        </div>
        <div className="flex items-center gap-2">
          <JobStatusBadge status={rec.status} />
          {active && (
            <button className="btn-danger" onClick={cancel} disabled={busy === "cancel"}>
              {kz.form.cancelAudit}
            </button>
          )}
          {!active && (
            <button className="btn-secondary" onClick={retest} disabled={busy === "retest"}>
              {kz.form.retest}
            </button>
          )}
        </div>
      </div>

      {/* Барыс */}
      <div className="card">
        <div className="flex justify-between text-sm mb-2">
          <span className="font-medium">{kz.status.progress}</span>
          <span>{rec.progress}%</span>
        </div>
        <div className="h-2 rounded bg-gray-700 overflow-hidden">
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${rec.progress}%` }} />
        </div>
        <ul className="mt-3 space-y-1 text-sm">
          {rec.stages.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <StageIcon status={s.status} />
              <span className={s.status === "running" ? "text-blue-300" : s.status === "error" ? "text-red-400" : "text-gray-300"}>
                {s.label}
                {s.status === "running" && ` — ${kz.status.currentStage}`}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Ұпай */}
      {rec.status === "completed" || rec.status === "blocked" ? (
        <>
          <div className="card">
            <div className="flex flex-wrap gap-6 items-end">
              <div>
                <div className="text-xs text-gray-400">{kz.score.total}</div>
                <div className="text-4xl font-bold">{rec.totalScore}<span className="text-lg text-gray-400"> {kz.score.outOf}</span></div>
              </div>
              <div>
                <div className="text-xs text-gray-400">{rec.verificationCoverage >= 0.7 ? kz.score.confirmed : kz.score.provisional}</div>
                <div className="text-3xl font-bold text-gold">{rec.provisionalScore}/100</div>
              </div>
              <div>
                <div className="text-xs text-gray-400">{kz.score.verificationCoverage}</div>
                <div className="text-2xl font-semibold">{Math.round(rec.verificationCoverage * 100)}%</div>
              </div>
              <div>
                <div className="text-xs text-gray-400">{kz.score.evidenceConfidence}</div>
                <div className="text-2xl font-semibold">{Math.round(rec.evidenceConfidence * 100)}%</div>
              </div>
            </div>
            {rec.verificationCoverage < 0.7 && <p className="text-yellow-400 text-sm mt-3">⚠ {kz.score.mayChange}</p>}
            <p className="text-xs text-gray-400 mt-3">{scoringStatement(rec, rec.verificationCoverage >= 0.7 ? "confirmed" : "provisional")}</p>
          </div>

          {/* Критерийлер */}
          <div className="card">
            <h2 className="font-semibold mb-3">{kz.score.criteria}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-700">
                    <th className="py-2 pr-3">{kz.form.assignment}</th>
                    <th className="py-2 pr-3">{kz.score.maxPoints}</th>
                    <th className="py-2 pr-3">{kz.score.earnedPoints}</th>
                    <th className="py-2">{kz.score.explanation}</th>
                  </tr>
                </thead>
                <tbody>
                  {rec.criteria.map((c) => (
                    <tr key={c.key} className="border-b border-gray-800 align-top">
                      <td className="py-2 pr-3 font-medium">{CRITERION_LABELS[c.key]}</td>
                      <td className="py-2 pr-3">{c.maxPoints}</td>
                      <td className={`py-2 pr-3 font-bold ${c.verified ? "" : "text-gray-500"}`}>
                        {c.earnedPoints}{!c.verified && " *"}
                      </td>
                      <td className="py-2 text-gray-300">
                        {c.explanation}
                        {c.recommendations.length > 0 && (
                          <ul className="list-disc pl-4 mt-1 text-gray-400">
                            {c.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 mt-2">* — критерий тексерілмеді: ұпай берілмеді де, нөл де қойылмады.</p>
          </div>

          {/* Тест нәтижелері */}
          {groups.map((g) => {
            const tests = rec.tests.filter((t) => t.status === g.key);
            if (tests.length === 0) return null;
            return (
              <div className="card" key={g.key}>
                <h2 className="font-semibold mb-2">{g.title} ({tests.length})</h2>
                <div className="space-y-3">
                  {tests.map((t) => (
                    <div key={t.id} className="rounded-lg bg-darkbg p-3 text-sm">
                      <div className="flex justify-between gap-2 flex-wrap">
                        <span className="font-medium">{t.name}</span>
                        <StatusBadge status={t.status} />
                      </div>
                      <div className="text-gray-400 mt-1 text-xs">Талап: {reqText(t.requirementId)}</div>
                      <div className="text-gray-300 mt-1"><span className="text-gray-500">{kz.test.expected}:</span> {t.expected}</div>
                      <div className="text-gray-300"><span className="text-gray-500">{kz.test.actual}:</span> {t.actual}</div>
                      {t.limitations && <div className="text-orange-300/80 mt-1 text-xs">{kz.test.limitations}: {t.limitations}</div>}
                      {t.error && <div className="text-red-400 mt-1 text-xs">{t.error}</div>}
                      {t.screenshot && (
                        <details className="mt-2">
                          <summary className="text-blue-400 cursor-pointer text-xs">{kz.test.evidence}</summary>
                          <img
                            className="mt-2 rounded border border-gray-700 max-w-md"
                            src={`/api/evidence/${t.screenshot}?token=${encodeURIComponent(getToken())}`}
                            alt={t.name}
                            loading="lazy"
                          />
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Қауіпсіздік, тарих, ұсыныстар, шектеулер */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="card">
              <h2 className="font-semibold mb-2">{kz.errors.securityWarnings}</h2>
              {rec.securityWarnings.length === 0 ? <p className="text-gray-400 text-sm">{kz.report.noneFound}</p> : (
                <ul className="list-disc pl-5 text-sm text-orange-300 space-y-1">
                  {rec.securityWarnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </div>
            <div className="card">
              <h2 className="font-semibold mb-2">{kz.report.historicalSection}</h2>
              {rec.historicalNotes.length === 0 ? <p className="text-gray-400 text-sm">{kz.report.noneFound}</p> : (
                <ul className="list-disc pl-5 text-sm text-gray-300 space-y-1">
                  {rec.historicalNotes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              )}
              <p className="text-xs text-gray-500 mt-2">{kz.score.aiPreliminary} — {kz.score.needsInstructorCheck}</p>
            </div>
            <div className="card">
              <h2 className="font-semibold mb-2">{kz.errors.topFive}</h2>
              {rec.topImprovements.length === 0 ? <p className="text-gray-400 text-sm">{kz.report.noneFound}</p> : (
                <ol className="list-decimal pl-5 text-sm space-y-1">
                  {rec.topImprovements.map((im, i) => <li key={i}>{im}</li>)}
                </ol>
              )}
            </div>
            <div className="card">
              <h2 className="font-semibold mb-2">{kz.report.limitationsSection}</h2>
              <ul className="list-disc pl-5 text-sm text-gray-300 space-y-1 max-h-64 overflow-y-auto">
                {rec.limitations.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </div>
          </div>

          {/* Экспорт */}
          <div className="card flex gap-3 flex-wrap">
            {rec.reportRefs.pdf && <DownloadButton path={`/api/reports/${rec.reportRefs.pdf.split("/").pop()}`} filename={`esept-${rec.id}.pdf`} label={kz.reports.downloadPdf} />}
            {rec.reportRefs.csv && <DownloadButton path={`/api/reports/${rec.reportRefs.csv.split("/").pop()}`} filename={`esept-${rec.id}.csv`} label={kz.reports.downloadCsv} />}
            {!rec.reportRefs.pdf && !rec.reportRefs.csv && <span className="text-gray-400 text-sm">{kz.reports.empty}</span>}
          </div>
        </>
      ) : rec.status === "failed" ? (
        <ErrorBox message={kz.status.failed} details={rec.limitations} />
      ) : rec.status === "cancelled" ? (
        <p className="text-gray-400">{kz.status.cancelled}</p>
      ) : null}
    </div>
  );
}

function StageIcon({ status }: { status: string }) {
  if (status === "done") return <span className="text-green-400">✔</span>;
  if (status === "running") return <span className="text-blue-400 animate-pulse">●</span>;
  if (status === "error") return <span className="text-red-400">✖</span>;
  if (status === "skipped") return <span className="text-orange-400">⊘</span>;
  return <span className="text-gray-600">○</span>;
}
