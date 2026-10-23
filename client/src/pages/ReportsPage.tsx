import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { kz } from "@gha/shared";
import type { EvaluationRecord } from "@gha/shared";
import { DownloadButton, EmptyState, Spinner } from "../components/ui";

export default function ReportsPage() {
  const [evals, setEvals] = useState<EvaluationRecord[] | null>(null);

  useEffect(() => {
    api.get<{ evaluations: EvaluationRecord[] }>("/api/audits")
      .then((d) => setEvals(d.evaluations.filter((e) => e.reportRefs.pdf || e.reportRefs.csv)))
      .catch(() => setEvals([]));
  }, []);

  if (!evals) return <Spinner />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gold">{kz.reports.title}</h1>
      {evals.length === 0 ? (
        <EmptyState text={kz.reports.empty} />
      ) : (
        <div className="space-y-3">
          {evals.map((e) => (
            <div key={e.id} className="card flex justify-between items-center flex-wrap gap-3">
              <div>
                <Link to={`/results/${e.id}`} className="font-medium text-blue-400">
                  {e.studentName} — {e.groupName} ({e.assignmentId})
                </Link>
                <div className="text-xs text-gray-500">{new Date(e.createdAt).toLocaleString("kk-KZ")}</div>
              </div>
              <div className="flex gap-2">
                {e.reportRefs.pdf && (
                  <DownloadButton
                    path={`/api/reports/${e.reportRefs.pdf.split("/").pop()}`}
                    filename={`esept-${e.id}.pdf`}
                    label={kz.reports.downloadPdf}
                  />
                )}
                {e.reportRefs.csv && (
                  <DownloadButton
                    path={`/api/reports/${e.reportRefs.csv.split("/").pop()}`}
                    filename={`esept-${e.id}.csv`}
                    label={kz.reports.downloadCsv}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
