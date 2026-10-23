import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { kz, ASSIGNMENTS } from "@gha/shared";
import { ErrorBox } from "../components/ui";

interface FormState {
  studentName: string;
  groupName: string;
  projectUrl: string;
  repositoryUrl: string;
  assignmentId: string;
  instructorNotes: string;
}

export default function NewAuditPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>({
    studentName: "", groupName: "", projectUrl: "", repositoryUrl: "", assignmentId: "", instructorNotes: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<{ message: string; details?: string[] } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Жаңа бет ашылғанда қателерді тазалау
    setServerError(null);
  }, []);

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: "" }));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (form.studentName.trim().length < 2) e.studentName = kz.form.required;
    if (form.groupName.trim().length < 2) e.groupName = kz.form.required;
    if (!form.projectUrl.trim()) e.projectUrl = kz.form.required;
    else {
      try {
        const u = new URL(form.projectUrl.trim());
        if (u.protocol !== "http:" && u.protocol !== "https:") e.projectUrl = kz.form.invalidUrl;
      } catch {
        e.projectUrl = kz.form.invalidUrl;
      }
    }
    if (!form.assignmentId) e.assignmentId = kz.form.selectAssignment;
    if (form.repositoryUrl.trim()) {
      try { new URL(form.repositoryUrl.trim()); } catch { e.repositoryUrl = kz.form.invalidUrl; }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setServerError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await api.post<{ id: string }>("/api/audits", {
        studentName: form.studentName.trim(),
        groupName: form.groupName.trim(),
        projectUrl: form.projectUrl.trim(),
        repositoryUrl: form.repositoryUrl.trim() || undefined,
        assignmentId: form.assignmentId,
        instructorNotes: form.instructorNotes.trim() || undefined,
      });
      navigate(`/results/${res.id}`);
    } catch (e) {
      setServerError({
        message: e instanceof Error ? e.message : kz.common.error,
        details: (e as { details?: string[] }).details,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-bold text-gold">{kz.nav.newAudit}</h1>
      <form onSubmit={submit} className="card space-y-4" noValidate>
        <div>
          <label className="label">{kz.form.studentName} *</label>
          <input className="input" value={form.studentName} onChange={(e) => set("studentName", e.target.value)} placeholder="Мысалы: Айбек Сериков" />
          {errors.studentName && <p className="text-xs text-red-400 mt-1">{errors.studentName}</p>}
        </div>
        <div>
          <label className="label">{kz.form.groupName} *</label>
          <input className="input" value={form.groupName} onChange={(e) => set("groupName", e.target.value)} placeholder="Мысалы: CYB26-1" />
          {errors.groupName && <p className="text-xs text-red-400 mt-1">{errors.groupName}</p>}
        </div>
        <div>
          <label className="label">{kz.form.projectUrl} *</label>
          <input className="input" value={form.projectUrl} onChange={(e) => set("projectUrl", e.target.value)} placeholder="https://..." />
          {errors.projectUrl && <p className="text-xs text-red-400 mt-1">{errors.projectUrl}</p>}
        </div>
        <div>
          <label className="label">{kz.form.repositoryUrl}</label>
          <input className="input" value={form.repositoryUrl} onChange={(e) => set("repositoryUrl", e.target.value)} placeholder="https://github.com/..." />
          {errors.repositoryUrl && <p className="text-xs text-red-400 mt-1">{errors.repositoryUrl}</p>}
        </div>
        <div>
          <label className="label">{kz.form.assignment} *</label>
          <select className="input" value={form.assignmentId} onChange={(e) => set("assignmentId", e.target.value)}>
            <option value="">— {kz.form.selectAssignment} —</option>
            {ASSIGNMENTS.map((a) => (
              <option key={a.id} value={a.id}>{a.id}. {a.title} ({a.genre})</option>
            ))}
          </select>
          {errors.assignmentId && <p className="text-xs text-red-400 mt-1">{errors.assignmentId}</p>}
        </div>
        <div>
          <label className="label">{kz.form.instructorNotes}</label>
          <textarea className="input" rows={3} value={form.instructorNotes} onChange={(e) => set("instructorNotes", e.target.value)} />
        </div>
        {serverError && <ErrorBox message={serverError.message} details={serverError.details} />}
        <button className="btn-primary" disabled={submitting}>
          {submitting ? kz.common.loading : kz.form.startAudit}
        </button>
      </form>
    </div>
  );
}
