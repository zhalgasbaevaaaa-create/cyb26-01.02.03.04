// CSV есебі: үш кесте (критерийлер, тестілер, жалпы) бір файлда, бөлек бөлімдермен.
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "../config.js";
import { buildCsv, CSV_HEADERS, kz } from "@gha/shared";
import type { EvaluationRecord } from "@gha/shared";

const STATUS_KK: Record<string, string> = {
  PASS: kz.test.PASS,
  PARTIAL: kz.test.PARTIAL,
  FAIL: kz.test.FAIL,
  NOT_VERIFIED: kz.test.NOT_VERIFIED,
  BLOCKED: kz.test.BLOCKED,
};

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

export async function generateCsvReport(rec: EvaluationRecord): Promise<string> {
  const dir = path.join(CONFIG.dataDir, "reports");
  await fs.mkdir(dir, { recursive: true });
  const fname = `esept-${rec.id}.csv`;

  const general = buildCsv(
    ["Өріс", "Мәні"],
    [
      [kz.form.studentName, rec.studentName],
      [kz.form.groupName, rec.groupName],
      [kz.form.projectUrl, rec.projectUrl],
      [kz.form.repositoryUrl, rec.repositoryUrl ?? ""],
      [kz.form.assignment, rec.assignmentId],
      [kz.report.evaluationDate, new Date(rec.createdAt).toLocaleString("kk-KZ")],
      [kz.score.total, rec.totalScore],
      [kz.score.provisional, `${rec.provisionalScore}/100`],
      [kz.score.verificationCoverage, `${Math.round(rec.verificationCoverage * 100)}%`],
      [kz.score.evidenceConfidence, `${Math.round(rec.evidenceConfidence * 100)}%`],
      ["Рубрика нұсқасы", rec.rubricVersion],
    ],
  );

  const criteria = buildCsv(
    [...CSV_HEADERS.criteria],
    rec.criteria.map((c) => [
      CRITERION_LABELS[c.key] ?? c.key,
      c.maxPoints,
      c.earnedPoints,
      c.verified ? kz.common.yes : kz.common.no,
      c.explanation,
      c.failedRequirements.join("; "),
      c.partialRequirements.join("; "),
      c.unverifiedRequirements.join("; "),
    ]),
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
    "=== ЖАЛПЫ МӘЛІМЕТ ===\r\n" + general.replace(/^\uFEFF/, "") +
    "\r\n=== КРИТЕРИЙЛЕР ===\r\n" + criteria.replace(/^\uFEFF/, "") +
    "\r\n=== ТЕСТ НӘТИЖЕЛЕРІ ===\r\n" + results.replace(/^\uFEFF/, "");
  const finalContent = "\uFEFF" + content;

  await fs.writeFile(path.join(dir, fname), finalContent, "utf-8");
  return `reports/${fname}`;
}
