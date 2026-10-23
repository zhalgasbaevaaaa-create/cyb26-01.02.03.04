// PDF есебі — қазақша Unicode (DejaVu қаріптері).
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config.js";
import { kz } from "@gha/shared";
import type { EvaluationRecord } from "@gha/shared";

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
  // Құпияға ұқсас жолдарды есептен аластау (redaction)
  return text
    .replace(/(AIza[0-9A-Za-z_-]{6})[0-9A-Za-z_-]+/g, "$1…[ЖАСЫРЫЛДЫ]")
    .replace(/(ghp_[A-Za-z0-9]{4})[A-Za-z0-9]+/g, "$1…[ЖАСЫРЫЛДЫ]")
    .replace(/(sk-[A-Za-z0-9]{4})[A-Za-z0-9]+/g, "$1…[ЖАСЫРЫЛДЫ]");
}

export async function generatePdfReport(rec: EvaluationRecord, assignmentTitle: string): Promise<string> {
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

    const H1 = (t: string) => { doc.font("kk-bold").fontSize(16).text(t, { underline: false }); doc.moveDown(0.4); doc.font("kk").fontSize(10); };
    const H2 = (t: string) => { doc.font("kk-bold").fontSize(12).text(t); doc.moveDown(0.2); doc.font("kk").fontSize(10); };
    const P = (t: string) => doc.fontSize(10).text(sanitize(t));

    // Титул
    doc.font("kk-bold").fontSize(18).text("GAME HUB PROJECT AUDITOR", { align: "center" });
    doc.font("kk").fontSize(12).text("Тексеру есебі", { align: "center" });
    doc.moveDown(1);

    H1("1. Студент туралы мәлімет");
    P(`${kz.form.studentName}: ${rec.studentName}`);
    P(`${kz.form.groupName}: ${rec.groupName}`);
    if (rec.instructorNotes) P(`${kz.form.instructorNotes}: ${rec.instructorNotes}`);

    H1("2. Жоба туралы мәлімет");
    P(`${kz.form.projectUrl}: ${rec.projectUrl}`);
    if (rec.repositoryUrl) P(`${kz.form.repositoryUrl}: ${rec.repositoryUrl}`);
    P(`${kz.form.assignment}: ${rec.assignmentId} — ${assignmentTitle}`);
    P(`${kz.report.evaluationDate}: ${new Date(rec.createdAt).toLocaleString("kk-KZ")}`);
    P(`Рубрика нұсқасы: ${rec.rubricVersion}`);

    H1("3. Жалпы нәтиже");
    const typeLabel = rec.verificationCoverage >= 0.7 ? kz.score.confirmed : kz.score.provisional;
    doc.font("kk-bold").fontSize(14).text(`${kz.score.total}: ${rec.totalScore} ұпай (тексерілген бөлік). ${typeLabel}: ${rec.provisionalScore}/100.`);
    doc.font("kk").fontSize(10);
    P(`${kz.score.verificationCoverage}: ${Math.round(rec.verificationCoverage * 100)}%; ${kz.score.evidenceConfidence}: ${Math.round(rec.evidenceConfidence * 100)}%`);
    if (rec.verificationCoverage < 0.7) P(kz.score.mayChange);

    H1("4. Критерийлер бойынша ұпай кестесі");
    for (const c of rec.criteria) {
      H2(`• ${labelFor(c.key)} — ${c.earnedPoints}/${c.maxPoints}${c.verified ? "" : " (тексерілмеді)"}`);
      P(c.explanation);
      if (c.recommendations.length) P(`Ұсыныстар: ${c.recommendations.join(" ")}`);
    }

    H1("5. Сәтті өткен тестілер");
    listTests(doc, rec, "PASS");
    H1("6. Орындалмаған тестілер");
    listTests(doc, rec, "FAIL");
    H1("7. Ішінара орындалған талаптар");
    listTests(doc, rec, "PARTIAL");
    H1("8. Тексерілмеген және бұғатталған тестілер");
    listTests(doc, rec, "NOT_VERIFIED");
    listTests(doc, rec, "BLOCKED");

    H1("9. Дәлелдер мен скриншоттар");
    const shots = rec.tests.filter((t) => t.screenshot);
    if (shots.length === 0) P(kz.report.noneFound);
    for (const t of shots.slice(0, 12)) {
      P(`— ${t.name}: ${t.screenshot}`);
    }

    H1("10. Қауіпсіздік ескертулері");
    if (rec.securityWarnings.length === 0) P(kz.report.noneFound);
    rec.securityWarnings.forEach((w) => P(`⚠ ${w}`));

    H1("11. Тарихи дәлдік ескертулері");
    if (rec.historicalNotes.length === 0) P(kz.report.noneFound);
    rec.historicalNotes.forEach((n) => P(`• ${n}`));
    P("Ескерту: жауаптар кілті болмаған жағдайда тарихи дәлдік «Алдын ала АИ бағалауы» ретінде беріледі және оқытушының растауын қажет етеді.");

    H1("12. Ең маңызды 5 жақсарту");
    if (rec.topImprovements.length === 0) P(kz.report.noneFound);
    rec.topImprovements.forEach((im, i) => P(`${i + 1}. ${im}`));

    H1("13. Қайта тексеру нәтижелері");
    if (rec.retestOf) P(`Бұл жазба — қайта тексеру (алдыңғы жазба: ${rec.retestOf}).`);
    else P("Қайта тексеру жүргізілмеген.");

    H1("14. Тексеру шектеулері");
    rec.limitations.forEach((l) => P(`• ${l}`));

    H1("15. Қорытынды баға қалай есептелді");
    P(
      "Әр талаптың күйі (Сәтті/Ішінара/Орындалмады/Тексерілмеді/Бұғатталды) нақты браузерлік дәлелдерден алынды. " +
        "Күй коэффициенті: Сәтті=1, Ішінара=0.5, Орындалмады=0; тексерілмеген талаптар ұпайға әсер етпейді. " +
        "Критерий ұпайы = максимум × (салмақталған коэффициенттер қосындысы / тексерілген салмақ). " +
        `Алдын ала баға = тексерілген ұпай / тексерілген критерийлер максимумы × 100. Нәтиже: ${rec.totalScore} ұпай; алдын ала: ${rec.provisionalScore}/100; жабылым: ${Math.round(rec.verificationCoverage * 100)}%.`,
    );

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
  const labels: Record<string, string> = {
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
  return labels[key] ?? key;
}
