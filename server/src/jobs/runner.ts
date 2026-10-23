// Тапсырмалар кезегі: нақты күй, болдырмау, таймаут, дубликатты болдырмау.
import { randomUUID } from "node:crypto";
import { CONFIG } from "../config.js";
import { getEvaluation, listEvaluations, saveEvaluation, getActiveRubric, getModuleSettings } from "../db/store.js";
import { runBrowserTests, makeStages, type ExecutorResult } from "../browser/executor.js";
import { requirementsForAssignment, getAssignment, scoreEvaluation, scoringStatement, computeCriticalFailures } from "@gha/shared";
import type { AuditMode, AuditRequest, EvaluationRecord, JobStage } from "@gha/shared";
import { generatePdfReport } from "../reports/pdf.js";
import { generateCsvReport } from "../reports/csv.js";

interface QueuedJob {
  id: string;
}

const queue: QueuedJob[] = [];
let runningCount = 0;

/** MODE A (тек URL) / MODE B (URL + GitHub) — master prompt §5. */
function detectMode(repositoryUrl?: string): AuditMode {
  return repositoryUrl && /github\.com/i.test(repositoryUrl) ? "URL_GITHUB" : "URL_ONLY";
}

export function queueLength(): number {
  return queue.length;
}

export async function createAudit(
  req: AuditRequest,
  opts: { isRetest?: boolean } = {},
): Promise<{ ok: true; record: EvaluationRecord } | { ok: false; error: string }> {
  // Дубликатты болдырмау: белсенді немесе жақында аяқталған тексеру.
  // Белсенді (queued/running) жоба үшін қайта тексеру де тыйым — уақыт терезесі ғана алынады.
  const recent = await listEvaluations();
  const now = Date.now();
  const dup = recent.find(
    (e) =>
      e.projectUrl === req.projectUrl &&
      e.assignmentId === req.assignmentId &&
      (["queued", "running"].includes(e.status) ||
        (!opts.isRetest && now - new Date(e.createdAt).getTime() < CONFIG.duplicateWindowMinutes * 60_000)),
  );
  if (dup) {
    return { ok: false, error: `Дубликат: осы жоба үшін тексеру бар (ID: ${dup.id}, күйі: ${dup.status}). Қайта тексеру үшін сол жазбаны пайдаланыңыз.` };
  }
  const rubric = await getActiveRubric();
  const rec: EvaluationRecord = {
    id: randomUUID().slice(0, 8),
    studentName: req.studentName.trim(),
    groupName: req.groupName.trim(),
    projectUrl: req.projectUrl.trim(),
    repositoryUrl: req.repositoryUrl?.trim() || undefined,
    assignmentId: req.assignmentId,
    instructorNotes: req.instructorNotes?.trim() || undefined,
    createdAt: new Date().toISOString(),
    status: "queued",
    stages: makeStages(),
    progress: 0,
    rubricVersion: rubric.version,
    mode: detectMode(req.repositoryUrl),
    tests: [],
    criteria: [],
    totalScore: 0,
    provisionalScore: 0,
    verificationCoverage: 0,
    evidenceConfidence: 0,
    securityWarnings: [],
    historicalNotes: [],
    topImprovements: [],
    limitations: [],
    criticalFailures: [],
    reportRefs: {},
  };
  await saveEvaluation(rec);
  queue.push({ id: rec.id });
  void processQueue();
  return { ok: true, record: rec };
}

export async function cancelAudit(id: string): Promise<boolean> {
  const rec = await getEvaluation(id);
  if (!rec) return false;
  if (rec.status === "queued") {
    const idx = queue.findIndex((j) => j.id === id);
    if (idx >= 0) queue.splice(idx, 1);
    rec.status = "cancelled";
    rec.finishedAt = new Date().toISOString();
    await saveEvaluation(rec);
    return true;
  }
  if (rec.status === "running") {
    rec.cancelRequested = true;
    await saveEvaluation(rec);
    return true;
  }
  return false;
}

export async function retest(id: string): Promise<{ ok: true; record: EvaluationRecord } | { ok: false; error: string }> {
  const rec = await getEvaluation(id);
  if (!rec) return { ok: false, error: "Жазба табылмады." };
  return createAudit({
    studentName: rec.studentName,
    groupName: rec.groupName,
    projectUrl: rec.projectUrl,
    repositoryUrl: rec.repositoryUrl,
    assignmentId: rec.assignmentId,
    instructorNotes: rec.instructorNotes,
  }, { isRetest: true }).then((r) => {
    if (r.ok) {
      r.record.retestOf = id;
      r.record.previousScore = rec.provisionalScore;
      void saveEvaluation(r.record);
    }
    return r;
  });
}

async function processQueue(): Promise<void> {
  while (runningCount < CONFIG.maxConcurrentJobs && queue.length > 0) {
    const job = queue.shift()!;
    runningCount++;
    void runJob(job.id).finally(() => {
      runningCount--;
      void processQueue();
    });
  }
}

async function setStage(rec: EvaluationRecord, key: string, status: JobStage["status"]): Promise<void> {
  const stage = rec.stages.find((s) => s.key === key);
  if (stage) stage.status = status;
  const done = rec.stages.filter((s) => s.status === "done" || s.status === "skipped" || s.status === "error").length;
  rec.progress = Math.round((done / rec.stages.length) * 100);
  await saveEvaluation(rec);
}

async function runJob(id: string): Promise<void> {
  const rec = await getEvaluation(id);
  if (!rec || rec.status !== "queued") return;
  rec.status = "running";
  rec.progress = 0;
  await saveEvaluation(rec);

  const moduleSettings = await getModuleSettings();
  const timeout = setTimeout(() => {
    rec.cancelRequested = true;
    void saveEvaluation(rec);
  }, moduleSettings.timeouts.jobTimeoutMs || CONFIG.jobTimeoutMs);

  try {
    const assignment = getAssignment(rec.assignmentId);
    const reqs = requirementsForAssignment(rec.assignmentId);
    const result: ExecutorResult = await runBrowserTests(
      rec,
      rec.assignmentId,
      reqs,
      async (key, status) => {
        await setStage(rec, key, status);
      },
      moduleSettings,
    );

    rec.tests = result.tests;
    rec.securityWarnings = result.securityWarnings;
    rec.historicalNotes = result.historicalNotes;

    if (rec.cancelRequested && rec.status === "running") {
      rec.status = "cancelled";
      rec.finishedAt = new Date().toISOString();
      await setStageFinal(rec, "cancelled");
      return;
    }

    // ===== 13. REQUIREMENTS СӘЙКЕСТІГІ: талаптар мен нәтижелерді сәйкестендіру =====
    await setStage(rec, "requirements", "running");
    const rubric = await getActiveRubric();
    rec.criticalFailures = computeCriticalFailures(rec.tests, rec.assignmentId);
    await setStage(rec, "requirements", "done");

    // ===== 14. БАҒАЛАУ: детерминистік ұпай есептеу =====
    await setStage(rec, "scoring", "running");
    const scoring = scoreEvaluation(reqs, rec.tests, rubric);
    rec.criteria = scoring.criteria;
    rec.totalScore = scoring.totalScore;
    rec.provisionalScore = scoring.provisionalScore;
    rec.verificationCoverage = scoring.verificationCoverage;
    rec.evidenceConfidence = scoring.evidenceConfidence;
    rec.topImprovements = scoring.topImprovements;
    rec.limitations = [...scoring.limitations, ...result.limitations];
    rec.rubricVersion = rubric.version;
    rec.finishedAt = new Date().toISOString();
    await setStage(rec, "scoring", "done");

    // ===== 15. ҚОРЫТЫНДЫ ЕСЕП: PDF/CSV дайындау (күй «completed» боларДАН БҰРЫН) =====
    await setStage(rec, "report", "running");
    try {
      rec.reportRefs.pdf = await generatePdfReport(rec, assignment?.title ?? rec.assignmentId, rubric);
    } catch (e) {
      console.error("PDF есебі дайындалмады:", e);
    }
    try {
      rec.reportRefs.csv = await generateCsvReport(rec, rubric);
    } catch (e) {
      console.error("CSV есебі дайындалмады:", e);
    }
    rec.limitations.push(scoringStatement(rec, scoring.scoreType));
    rec.status = result.loadFailed && result.tests.every((t) => t.status === "BLOCKED") ? "blocked" : "completed";
    await setStage(rec, "report", "done");
    await saveEvaluation(rec);
  } catch (e) {
    rec.status = "failed";
    rec.finishedAt = new Date().toISOString();
    rec.limitations.push(`Күтпеген қате: ${e instanceof Error ? e.message : String(e)}`);
    await setStageFinal(rec, "failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function setStageFinal(rec: EvaluationRecord, _status: string): Promise<void> {
  rec.progress = 100;
  await saveEvaluation(rec);
}
