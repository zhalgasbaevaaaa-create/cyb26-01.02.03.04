import { useEffect, useState } from "react";
import { kz, ASSIGNMENTS, REQUIREMENTS } from "@gha/shared";
import type { Requirement } from "@gha/shared";
import { Spinner } from "../components/ui";
import { api } from "../api";

const METHOD_KK: Record<string, string> = {
  browser: kz.assignments.methods.browser,
  static: kz.assignments.methods.static,
  answer_key: kz.assignments.methods.answer_key,
  manual: kz.assignments.methods.manual,
  unavailable: kz.assignments.methods.unavailable,
};

export default function AssignmentsPage() {
  const [selected, setSelected] = useState<string>("COMMON");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Матрицаны серверден алу (ортатқы дереккөз бір ғана)
    api.get("/api/assignments").then(() => setLoaded(true)).catch(() => setLoaded(true));
  }, []);

  const reqs: Requirement[] = REQUIREMENTS.filter((r) => r.assignmentId === selected);
  const current = ASSIGNMENTS.find((a) => a.id === selected);

  if (!loaded) return <Spinner />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gold">{kz.assignments.title}</h1>
      <p className="text-gray-400 text-sm max-w-3xl">{kz.assignments.subtitle}</p>

      <div className="flex flex-wrap gap-2">
        <button
          className={`btn ${selected === "COMMON" ? "bg-gold text-black" : "btn-secondary"}`}
          onClick={() => setSelected("COMMON")}
        >
          {kz.assignments.commonTitle}
        </button>
        {ASSIGNMENTS.map((a) => (
          <button
            key={a.id}
            className={`btn ${selected === a.id ? "bg-gold text-black" : "btn-secondary"}`}
            onClick={() => setSelected(a.id)}
          >
            {a.id}. {a.title}
          </button>
        ))}
      </div>

      {current && (
        <div className="card">
          <h2 className="font-bold text-lg">{current.title}</h2>
          <p className="text-sm text-gold">{current.genre}</p>
          <p className="text-sm text-gray-300 mt-2">{current.description}</p>
        </div>
      )}

      <div className="space-y-3">
        {reqs.map((r) => (
          <div key={r.id} className="card">
            <div className="flex justify-between flex-wrap gap-2">
              <div className="font-medium">
                <span className="text-gold mr-2">{r.id}</span>
                {r.displayText}
                {r.verificationStatus === "ambiguous" && (
                  <span className="ml-2 text-xs rounded bg-yellow-900 text-yellow-300 px-2 py-0.5">
                    ⚠ {kz.assignments.ambiguous}
                  </span>
                )}
              </div>
              <div className="flex gap-2 text-xs">
                <span className={`rounded px-2 py-0.5 ${r.required ? "bg-red-900 text-red-200" : "bg-gray-700 text-gray-300"}`}>
                  {r.required ? kz.assignments.mandatory : kz.assignments.optional}
                </span>
                <span className="rounded bg-blue-900 text-blue-200 px-2 py-0.5">{METHOD_KK[r.testMethod]}</span>
              </div>
            </div>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-blue-400">{kz.assignments.originalText}</summary>
              <p className="mt-2 text-gray-300 whitespace-pre-wrap border-l-2 border-gray-600 pl-3">{r.originalText}</p>
            </details>
            <div className="mt-2 text-sm grid md:grid-cols-2 gap-2">
              <div><span className="text-gray-500">{kz.assignments.expected}:</span> <span className="text-gray-300">{r.expectedBehavior}</span></div>
              <div><span className="text-gray-500">{kz.assignments.evidence}:</span> <span className="text-gray-300">{r.evidenceNeeded}</span></div>
            </div>
            {r.instructorNotes && (
              <p className="mt-2 text-xs text-yellow-300/90 border border-yellow-800 rounded p-2">📝 {r.instructorNotes}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
