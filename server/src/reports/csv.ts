// CSV есебі — master prompt §37 "CSV EXPORT" құрылымына сәйкес.
// Негізгі (бірінші) кесте — міндетті өрістер: студент, топ, ойын, URL, күні,
// 10 критерийдің әрқайсысының ұпайы, жалпы балл, тексеру пайызы, critical
// табылымдар, қайта тексеру мәртебесі (барлығы қазақша баған атауларымен).
// Төменде — толық детализация үшін қосымша кестелер (критерийлер түсіндірмесі,
// толық тест нәтижелері, ауырлық дәрежесі бойынша қателер).
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "../config.js";
import { buildCsv, CSV_HEADERS, kz, criterionLabel, getAssignment, DEFAULT_CRITERIA, gradingBandLabel, DEFAULT_GRADING_BANDS } from "@gha/shared";
import type { EvaluationRecord, RubricVersion } from "@gha/shared";
import { classifyErrorSeverity } from "./severity.js";

const STATUS_KK: Record<string, string> = {
  PASS: kz.test.PASS,
  PARTIAL: kz.test.PARTIAL,
  FAIL: kz.test.FAIL,
  NOT_VERIFIED: kz.test.NOT_VERIFIED,
  BLOCKED: kz.test.BLOCKED,
};

export async function generateCsvReport(rec: EvaluationRecord, rubric?: RubricVersion): Promise<string> {
  const dir = path.join(CONFIG.dataDir, "reports");
  await fs.mkdir(dir, { recursive: true });
  const fname = `esept-${rec.id}.csv`;

  const assignment = getAssignment(rec.assignmentId);
  const severity = classifyErrorSeverity(rec);
  const bands = rubric?.gradingBands ?? DEFAULT_GRADING_BANDS;

  // ===== Негізгі жол (§37: student; group; game; URL; date; 10 критерий; жалпы балл;
  // тексеру пайызы; critical табылымдар; қайта тексеру мәртебесі) =====
  const criterionByKey = new Map(rec.criteria.map((c) => [c.key, c]));
  const summaryHeaders = [
    "Студент",
    "Оқу тобы",
    "Ойын",
    "Жоба сілтемесі",
    "Күні",
    ...DEFAULT_CRITERIA.map((c) => `${criterionLabel(c.key).split(".")[0]}-критерий (${c.maxPoints} ұпай)`),
    "Жалпы балл (100-ден)",
    "Тексеру пайызы (%)",
    "Critical табылымдар саны",
    "Қайта тексеру мәртебесі",
  ];
  const summaryRow = [
    rec.studentName,
    rec.groupName,
    `${assignment?.title ?? rec.assignmentId} (${assignment?.genre ?? "—"})`,
    rec.projectUrl,
    new Date(rec.createdAt).toLocaleString("kk-KZ"),
    ...DEFAULT_CRITERIA.map((c) => criterionByKey.get(c.key)?.earnedPoints ?? 0),
    rec.totalScore,
    Math.round(rec.verificationCoverage * 100),
    rec.criticalFailures.length,
    rec.retestOf ? `${kz.report.retestStatusRetest} (алдыңғы: ${rec.previousScore ?? "—"} → жаңа: ${rec.totalScore})` : kz.report.retestStatusOriginal,
  ];
  const summary = buildCsv(summaryHeaders, [summaryRow]);

  const general = buildCsv(
    ["Өріс", "Мәні"],
    [
      [kz.form.studentName, rec.studentName],
      [kz.form.groupName, rec.groupName],
      [kz.form.projectUrl, rec.projectUrl],
      [kz.form.repositoryUrl, rec.repositoryUrl ?? "— (берілмеген)"],
      [kz.report.auditMode, rec.mode === "URL_GITHUB" ? kz.report.auditModeUrlGithub : kz.report.auditModeUrlOnly],
      [kz.form.assignment, rec.assignmentId],
      [kz.report.evaluationDate, new Date(rec.createdAt).toLocaleString("kk-KZ")],
      [kz.score.total, rec.totalScore],
      [kz.score.provisional, `${rec.provisionalScore}/100`],
      [kz.score.verificationCoverage, `${Math.round(rec.verificationCoverage * 100)}%`],
      [kz.score.evidenceConfidence, `${Math.round(rec.evidenceConfidence * 100)}%`],
      ["Рубрика нұсқасы", rec.rubricVersion],
      [kz.report.section13, `${rec.totalScore}/100 → ${gradingBandLabel(rec.totalScore, bands)}`],
    ],
  );

  const criteria = buildCsv(
    [...CSV_HEADERS.criteria],
    rec.criteria.map((c) => [
      criterionLabel(c.key),
      c.maxPoints,
      c.earnedPoints,
      c.verified ? kz.common.yes : kz.common.no,
      c.explanation,
      c.failedRequirements.join("; "),
      c.partialRequirements.join("; "),
      c.unverifiedRequirements.join("; "),
    ]),
  );

  const errorsBySeverity = buildCsv(
    ["Ауырлық дәрежесі", "Талап ID", "Тест атауы", "Нақты нәтиже"],
    [
      ...severity.critical.map((t) => ["CRITICAL", t.requirementId, t.name, t.actual]),
      ...severity.major.map((t) => ["MAJOR", t.requirementId, t.name, t.actual]),
      ...severity.minor.map((t) => ["MINOR", t.requirementId, t.name, t.actual]),
    ],
  );

  const results = buildCsv(
    [...CSV_HEADERS.results],
    rec.tests.map((t) => [
      t.id,
      t.requirementId,
      t.name,
      STATUS_KK[t.status] ?? t.status,
      t.startedAt,
      t.finishedAt,
      t.browser ?? "",
      t.viewport ?? "",
      t.actions.join(" | "),
      t.expected,
      t.actual,
      t.error ?? "",
      t.screenshot ?? "",
      t.limitations ?? "",
    ]),
  );

  const content =
    "=== НЕГІЗГІ КЕСТЕ (§37) ===\r\n" + summary.replace(/^\uFEFF/, "") +
    "\r\n=== ЖАЛПЫ МӘЛІМЕТ ===\r\n" + general.replace(/^\uFEFF/, "") +
    "\r\n=== КРИТЕРИЙЛЕР ===\r\n" + criteria.replace(/^\uFEFF/, "") +
    "\r\n=== ҚАТЕЛЕР (АУЫРЛЫҚ ДӘРЕЖЕСІ БОЙЫНША) ===\r\n" + errorsBySeverity.replace(/^\uFEFF/, "") +
    "\r\n=== ТЕСТ НӘТИЖЕЛЕРІ ===\r\n" + results.replace(/^\uFEFF/, "");
  const finalContent = "\uFEFF" + content;

  await fs.writeFile(path.join(dir, fname), finalContent, "utf-8");
  return `reports/${fname}`;
}
