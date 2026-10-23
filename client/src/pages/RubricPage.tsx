import { useEffect, useState } from "react";
import { api } from "../api";
import { kz, DEFAULT_RUBRIC, validateRubric } from "@gha/shared";
import type { RubricVersion } from "@gha/shared";
import { ErrorBox, Spinner } from "../components/ui";

export default function RubricPage() {
  const [rubric, setRubric] = useState<RubricVersion | null>(null);
  const [draft, setDraft] = useState<RubricVersion | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ active: RubricVersion }>("/api/rubric")
      .then((d) => { setRubric(d.active); setDraft(JSON.parse(JSON.stringify(d.active))); })
      .catch((e) => setError({ message: e.message }));
  }, []);

  if (!draft) return error ? <ErrorBox message={error.message} /> : <Spinner />;

  const sum = draft.criteria.reduce((s, c) => s + Number(c.maxPoints || 0), 0);
  const validation = validateRubric({ ...draft, criteria: draft.criteria.map((c) => ({ ...c, maxPoints: Number(c.maxPoints) })) });

  function setPoints(key: string, value: number) {
    setDraft((d) => d && { ...d, criteria: d.criteria.map((c) => (c.key === key ? { ...c, maxPoints: value } : c)) });
    setMessage("");
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage("");
    try {
      const res = await api.put<{ rubric: RubricVersion; message: string }>("/api/rubric", draft);
      setRubric(res.rubric);
      setDraft(JSON.parse(JSON.stringify(res.rubric)));
      setMessage(res.message);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : kz.common.error, details: (e as { details?: string[] }).details });
    } finally {
      setSaving(false);
    }
  }

  function restoreDefaults() {
    setDraft(JSON.parse(JSON.stringify(DEFAULT_RUBRIC)));
    setMessage("");
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold text-gold">{kz.rubric.title}</h1>
      <p className="text-sm text-gray-400">{kz.rubric.subtitle}</p>
      {rubric && <p className="text-sm text-gray-400">{kz.rubric.savedVersion} <b>{rubric.version}</b> — {kz.rubric.preservedNote}</p>}

      <div className="card space-y-3">
        {draft.criteria.map((c) => (
          <div key={c.key} className="flex items-center gap-3">
            <span className="flex-1 text-sm">{c.label}</span>
            <input
              type="number"
              min={0}
              max={40}
              className="input w-24 text-right"
              value={c.maxPoints}
              onChange={(e) => setPoints(c.key, Number(e.target.value))}
            />
          </div>
        ))}
        <div className={`text-sm font-medium ${sum === 100 ? "text-green-400" : "text-red-400"}`}>
          {kz.rubric.sumWarning} <b>{sum}</b>
        </div>

        <div className="border-t border-gray-700 pt-3 space-y-2">
          <h2 className="font-semibold text-sm">{kz.rubric.thresholds}</h2>
          <div className="flex items-center gap-3">
            <span className="flex-1 text-sm">{kz.rubric.passThreshold}</span>
            <input
              type="number" min={0} max={100} className="input w-24 text-right"
              value={draft.passThreshold}
              onChange={(e) => setDraft({ ...draft, passThreshold: Number(e.target.value) })}
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="flex-1 text-sm">{kz.rubric.provisionalThreshold}</span>
            <input
              type="number" min={0} max={100} className="input w-24 text-right"
              value={Math.round(draft.provisionalThreshold * 100)}
              onChange={(e) => setDraft({ ...draft, provisionalThreshold: Number(e.target.value) / 100 })}
            />
          </div>
        </div>

        {error && <ErrorBox message={error.message} details={error.details} />}
        {message && <p className="text-green-400 text-sm">{message}</p>}

        <div className="flex gap-2">
          <button className="btn-primary" onClick={save} disabled={!validation.valid || saving}>
            {saving ? kz.common.loading : kz.common.save}
          </button>
          <button className="btn-secondary" onClick={restoreDefaults}>{kz.rubric.restoreDefaults}</button>
        </div>
        {!validation.valid && (
          <ul className="text-xs text-red-400 list-disc pl-5">
            {validation.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
