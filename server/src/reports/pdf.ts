// PDF есебі — қазақша Unicode (DejaVu қаріптері).
// Құрылым: master prompt §27 "FINAL UNIVERSITY REPORT" — дәл 13 бөлім.
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config.js";
import { kz, criterionLabel, getAssignment, gradingBandLabel, DEFAULT_GRADING_BANDS } from "@gha/shared";
import type { EvaluationRecord, RubricVersion } from "@gha/shared";
import { classifyErrorSeverity } from "./severity.js";

// Алдымен репозиторийге салынған қаріптерді қолданамыз (Docker image-ге
// тәуелсіз, әрдайым бар болады); ОС-тің жүйелік DejaVu қаріптері — қосымша
// сақтық нұсқа ретінде қалдырылады (dev ортада орнатылған болса).
const FONT_CANDIDATES_REG = [
  path.join(CONFIG.fontsDir, "DejaVuSans.ttf"),
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
];
const FONT_CANDIDATES_BOLD = [
  path.join(CONFIG.fontsDir, "DejaVuSans-Bold.ttf"),
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
];

function findFont(candidates: string[]): string {
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `Қазақша Unicode қаріп файлы табылмады (ізделген жолдар: ${candidates.join(", ")}). ` +
      `PDF есебі жасалмайды — server/assets/fonts/ ішінде DejaVuSans.ttf бар-жоғын тексеріңіз.`,
  );
}

const FONT_REG = findFont(FONT_CANDIDATES_REG);
const FONT_BOLD = findFont(FONT_CANDIDATES_BOLD);

const STATUS_KK: Record<string, string> = {
  PASS: kz.test.PASS,
  PARTIAL: kz.test.PARTIAL,
  FAIL: kz.test.FAIL,
  NOT_VERIFIED: kz.test.NOT_VERIFIED,
  BLOCKED: kz.test.BLOCKED,
};

function sanitize(text: string): string {
  // Құпияға ұқсас жолдарды есептен аластау (redaction) — ешқашан шикі құпия
  // мәнін көрсетпеу (master prompt §31: "Құпия кілт анықталды — мәні әдейі жасырылды.").
  return text
    .replace(/AKIA[0-9A-Z]{16}/g, "[ЖАСЫРЫЛДЫ]")
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[ЖАСЫРЫЛДЫ]")
    .replace(/ghp_[A-Za-z0-9]{36}/g, "[ЖАСЫРЫЛДЫ]")
    .replace(/sk-[A-Za-z0-9]{20,}/g, "[ЖАСЫРЫЛДЫ]")
    .replace(/ya29\.[A-Za-z0-9_-]{20,}/g, "[ЖАСЫРЫЛДЫ]")
    .replace(/AIza[0-9A-Za-z_-]{35}/g, "[ЖАСЫРЫЛДЫ]");
}

export async function generatePdfReport(rec: EvaluationRecord, assignmentTitle: string, rubric?: RubricVersion): Promise<string> {
  const dir = path.join(CONFIG.dataDir, "reports");
  await fs.promises.mkdir(dir, { recursive: true });
  const fname = `esept-${rec.id}.pdf`;
  const out = path.join(dir, fname);

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Тексеру есебі — ${rec.studentName}`, Author: "GAME HUB PROJECT AUDITOR" } });
    doc.registerFont("kk", FONT_REG);
    doc.registerFont("kk-bold", FONT_BOLD);
    doc.font("kk");
    doc.pipe(fs.createWriteStream(out));

    const H1 = (t: string) => { doc.moveDown(0.6); doc.font("kk-bold").fontSize(14).fillColor("#9a7b1f").text(t); doc.fillColor("black"); doc.moveDown(0.3); doc.font("kk").fontSize(10); };
    const H2 = (t: string) => { doc.font("kk-bold").fontSize(11).text(t); doc.moveDown(0.15); doc.font("kk").fontSize(10); };
    const P = (t: string) => doc.fontSize(10).text(sanitize(t));
    const small = (t: string) => doc.fontSize(8).fillColor("#666").text(sanitize(t)).fillColor("black");

    const assignment = getAssignment(rec.assignmentId);
    const severity = classifyErrorSeverity(rec);
    const bands = rubric?.gradingBands ?? DEFAULT_GRADING_BANDS;

    // Титул
    doc.font("kk-bold").fontSize(18).text("GAME HUB PROJECT AUDITOR", { align: "center" });
    doc.font("kk").fontSize(12).text("Университеттік тексеру есебі (FINAL UNIVERSITY REPORT)", { align: "center" });
    doc.moveDown(1);

    // ===== 1. ЖОБА ТУРАЛЫ АҚПАРАТ =====
    H1(kz.report.section1);
    P(`${kz.form.studentName}: ${rec.studentName}`);
    P(`${kz.form.groupName}: ${rec.groupName}`);
    P(`${kz.form.projectUrl}: ${rec.projectUrl}`);
    P(`${kz.report.githubRepo}: ${rec.repositoryUrl || "— (берілмеген)"}`);
    P(`${kz.report.gameType}: ${assignment?.genre ?? "—"} (${rec.assignmentId} — ${assignmentTitle})`);
    P(`${kz.report.evaluationDate}: ${new Date(rec.createdAt).toLocaleString("kk-KZ")}`);
    P(`${kz.report.auditMode}: ${rec.mode === "URL_GITHUB" ? kz.report.auditModeUrlGithub : kz.report.auditModeUrlOnly}`);
    P(`Рубрика нұсқасы: ${rec.rubricVersion}`);
    if (rec.instructorNotes) P(`${kz.form.instructorNotes}: ${rec.instructorNotes}`);
    if (rec.retestOf) P(`${kz.report.retestStatus}: ${kz.report.retestStatusRetest} (алдыңғы жазба: ${rec.retestOf}, алдыңғы баға: ${rec.previousScore ?? "—"})`);
    else P(`${kz.report.retestStatus}: ${kz.report.retestStatusOriginal}`);

    // ===== 2. ҚОРЫТЫНДЫ БАҒА =====
    H1(kz.report.section2);
    doc.font("kk-bold").fontSize(16).text(`FINAL SCORE: ${rec.totalScore} / 100`);
    doc.font("kk").fontSize(10);
    const typeLabel = rec.verificationCoverage >= 0.7 ? kz.score.confirmed : kz.score.provisional;
    P(`${typeLabel}: ${rec.provisionalScore}/100`);
    doc.moveDown(0.2);
    H2("Баға сенімділігі");
    P(`• ${kz.score.verificationCoverage} (автоматты тексерілген талаптар үлесі): ${Math.round(rec.verificationCoverage * 100)}%`);
    P(`• ${kz.score.evidenceConfidence} (дәлел сенімділігі): ${Math.round(rec.evidenceConfidence * 100)}%`);
    const codeVerifiedPct = rec.repositoryUrl ? Math.round((rec.tests.filter((t) => t.requirementId === "C-CODE" || t.requirementId === "C-SEC-REPO").length > 0 ? 100 : 0)) : 0;
    P(`• Код деңгейінде тексерілген (source-code verified) үлес: ${rec.repositoryUrl ? `${codeVerifiedPct}% (репозиторий берілді)` : "0% (репозиторий берілмеген)"}`);
    const statusCounts = { PASS: 0, PARTIAL: 0, FAIL: 0, NOT_VERIFIED: 0, BLOCKED: 0 } as Record<string, number>;
    for (const t of rec.tests) statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
    P(`• Орындалған тестілер саны: ${rec.tests.length}; Сәтті: ${statusCounts.PASS}; Орындалмады: ${statusCounts.FAIL}; Ішінара: ${statusCounts.PARTIAL}; Тексерілмеді: ${statusCounts.NOT_VERIFIED}; Бұғатталды: ${statusCounts.BLOCKED}`);
    if (rec.verificationCoverage < 0.7) P(kz.score.mayChange);
    if (rec.criticalFailures.length > 0) {
      doc.moveDown(0.2);
      H2(`⚠ ${kz.report.criticalFailuresTitle}`);
      rec.criticalFailures.forEach((cf) => P(`• ${cf.message}`));
    }

    // ===== 3. 10 КРИТЕРИЙ БОЙЫНША БАҒА =====
    H1(kz.report.section3);
    small("№  Критерий (Максимум → Нәтиже → Балл)");
    rec.criteria.forEach((c) => {
      H2(labelFor(c.key));
      P(`   Максимум: ${c.maxPoints} | Нәтиже: ${c.verified ? "тексерілді" : "толық тексерілмеді"} | Балл: ${c.earnedPoints}/${c.maxPoints}`);
      P(`   ${c.explanation}`);
    });

    // ===== 4. ОРЫНДАЛҒАН ТАЛАПТАР =====
    H1(kz.report.section4);
    listTests(doc, rec, "PASS");

    // ===== 5. ОРЫНДАЛМАҒАН ТАЛАПТАР =====
    H1(kz.report.section5);
    listTests(doc, rec, "FAIL");

    // ===== 6. ҚАТЕЛЕР (ауырлық дәрежесі бойынша) =====
    H1(kz.report.section6);
    small(kz.report.severityRule);
    doc.moveDown(0.2);
    H2(`${kz.report.severityCritical} (${severity.critical.length})`);
    if (severity.critical.length === 0) P(kz.report.noneFound);
    severity.critical.forEach((t) => P(`• ${t.name} — ${sanitize(t.actual)}`));
    H2(`${kz.report.severityMajor} (${severity.major.length})`);
    if (severity.major.length === 0) P(kz.report.noneFound);
    severity.major.forEach((t) => P(`• ${t.name} — ${sanitize(t.actual)}`));
    H2(`${kz.report.severityMinor} (${severity.minor.length})`);
    if (severity.minor.length === 0) P(kz.report.noneFound);
    severity.minor.forEach((t) => P(`• ${t.name} — ${sanitize(t.actual)}`));

    // ===== 7. SECURITY FINDINGS =====
    H1(kz.report.section7);
    if (rec.securityWarnings.length === 0) P(kz.report.noneFound);
    rec.securityWarnings.forEach((w) => P(`⚠ ${sanitize(w)}`));
    doc.moveDown(0.2);
    small("Толық қауіпсіздік тестілерінің тізімі (C-SEC-*):");
    rec.tests.filter((t) => t.requirementId.startsWith("C-SEC-")).forEach((t) => {
      doc.font("kk-bold").fontSize(9).text(`• ${t.name} [${STATUS_KK[t.status]}]`);
      doc.font("kk").fontSize(9).text(sanitize(`  ${t.actual}`));
    });
    doc.fontSize(10);

    // ===== 8. GAMEPLAY FINDINGS =====
    H1(kz.report.section8);
    const gameplayIds = new Set(["A1-MECH", "A2-MAP", "A3-TARGETS", "A4-RACE", "A5-MATCH", "A6-PUZZLES", "C-ALGO", "C-DIFF", "C-LIVES"]);
    const gameplayTests = rec.tests.filter((t) => gameplayIds.has(t.requirementId) || t.requirementId.endsWith("-LEVELS") || t.requirementId.endsWith("-MECH"));
    if (gameplayTests.length === 0) P(kz.report.noneFound);
    gameplayTests.forEach((t) => {
      doc.font("kk-bold").fontSize(9).text(`• ${t.name} [${STATUS_KK[t.status]}]`);
      doc.font("kk").fontSize(9).text(sanitize(`  ${t.actual}`));
      if (t.limitations) doc.fontSize(8).fillColor("#666").text(sanitize(`  Шектеу: ${t.limitations}`)).fillColor("black");
    });
    doc.fontSize(10);

    // ===== 9. CODE FINDINGS =====
    H1(kz.report.section9);
    if (!rec.repositoryUrl) {
      P(kz.report.noRepoProvided);
    } else {
      const codeTests = rec.tests.filter((t) => t.requirementId === "C-CODE" || t.requirementId === "C-SEC-REPO");
      if (codeTests.length === 0) P(kz.report.noneFound);
      codeTests.forEach((t) => {
        doc.font("kk-bold").fontSize(9).text(`• ${t.name} [${STATUS_KK[t.status]}]`);
        doc.font("kk").fontSize(9).text(sanitize(`  ${t.actual}`));
      });
      doc.fontSize(10);
    }

    // ===== 10. HISTORICAL CONTENT =====
    H1(kz.report.section10);
    const taskTests = rec.tests.filter((t) => t.requirementId.startsWith("C-TASK-") || t.requirementId === "C-HIST-ACC");
    if (taskTests.length === 0) P(kz.report.noneFound);
    taskTests.forEach((t) => {
      doc.font("kk-bold").fontSize(9).text(`• ${t.name} [${STATUS_KK[t.status]}]`);
      doc.font("kk").fontSize(9).text(sanitize(`  ${t.actual}`));
    });
    doc.fontSize(10);
    if (rec.historicalNotes.length > 0) {
      doc.moveDown(0.2);
      H2("Қосымша ескертулер:");
      rec.historicalNotes.forEach((n) => P(`• ${n}`));
    }
    P("Ескерту: жауаптар кілті болмаған жағдайда тарихи дәлдік «Алдын ала АИ бағалауы» ретінде беріледі және оқытушының растауын қажет етеді.");

    // ===== 11. EVIDENCE =====
    H1(kz.report.section11);
    const shots = rec.tests.filter((t) => t.screenshot);
    if (shots.length === 0) P(kz.report.noneFound);
    for (const t of shots.slice(0, 20)) {
      P(`— ${t.name} [${STATUS_KK[t.status]}]: ${t.screenshot}`);
    }

    // ===== 12. TOP 10 RECOMMENDATIONS =====
    H1(kz.report.section12);
    if (rec.topImprovements.length === 0) P(kz.report.noneFound);
    rec.topImprovements.slice(0, 10).forEach((im, i) => P(`${i + 1}. ${im}`));

    // ===== 13. FINAL DECISION =====
    H1(kz.report.section13);
    const decisionLabel = gradingBandLabel(rec.totalScore, bands);
    doc.font("kk-bold").fontSize(13).text(`${rec.totalScore}/100 → ${decisionLabel}`);
    doc.font("kk").fontSize(10);
    doc.moveDown(0.2);
    const sortedBands = [...bands].sort((a, b) => b.min - a.min);
    sortedBands.forEach((b, i) => {
      const upper = i === 0 ? 100 : sortedBands[i - 1].min - 1;
      P(`• ${b.min}–${upper}: ${b.label}`);
    });
    doc.moveDown(0.2);
    P(
      "Қорытынды баға қалай есептелді: әр талаптың күйі (Сәтті/Ішінара/Орындалмады/Тексерілмеді/Бұғатталды) нақты " +
        "браузерлік дәлелдерден алынды. Күй коэффициенті: Сәтті=1, Ішінара=0.5, Орындалмады=0; тексерілмеген талаптар " +
        "ұпайға әсер етпейді. Критерий ұпайы = максимум × (салмақталған коэффициенттер қосындысы / тексерілген салмақ).",
    );
    if (rec.limitations.length > 0) {
      doc.moveDown(0.2);
      H2(kz.report.limitationsSection);
      rec.limitations.forEach((l) => P(`• ${l}`));
    }

    doc.end();
    doc.on("end", resolve);
    doc.on("error", reject);
  });
  return `reports/${fname}`;
}

function listTests(doc: PDFKit.PDFDocument, rec: EvaluationRecord, status: string): void {
  const tests = rec.tests.filter((t) => t.status === status);
  if (tests.length === 0) {
    doc.fontSize(10).text(kz.report.noneFound);
    return;
  }
  for (const t of tests) {
    doc.font("kk-bold").fontSize(10).text(`• ${t.name} [${STATUS_KK[t.status]}]`);
    doc.font("kk").fontSize(9).text(sanitize(`  Күтілетін: ${t.expected}`));
    doc.text(sanitize(`  Нақты: ${t.actual}`));
    if (t.limitations) doc.text(sanitize(`  Шектеу: ${t.limitations}`));
    doc.moveDown(0.3);
    doc.fontSize(10);
  }
}

function labelFor(key: string): string {
  return criterionLabel(key);
}
