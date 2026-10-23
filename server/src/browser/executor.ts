// Нақты браузерлік тестілеу қозғалтқышы (Playwright).
// Мұнда ешқандай нәтиже ойлап табылмайды: әр тест нақты әрекет пен бақылауға негізделеді.
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CONFIG } from "../config.js";
import { isRequestHostAllowed, validateUrl } from "@gha/shared/src/urlSecurity.js";
import type { EvaluationRecord, JobStage, Requirement, TestResult, TestStatus } from "@gha/shared";
import { PROFILES, TASK_TYPE_KEYWORDS, LIVES_KEYWORDS, HUB_KEYWORDS, GOOGLE_LOGIN_KEYWORDS } from "./profiles.js";
import { loadAnswerKey, compareAgainstKey } from "./answerKey.js";

export const STAGE_KEYS = [
  "validate",
  "load",
  "ui",
  "mechanics",
  "history",
  "auth",
  "responsive",
  "security",
  "repo",
  "scoring",
] as const;

export const STAGE_LABELS: Record<string, string> = {
  validate: "Сілтемені тексеру және қауіпсіздік сүзгісі",
  load: "Сайтты жүктеу және қолжетімділікті тексеру",
  ui: "Интерфейс пен навигацияны тексеру",
  mechanics: "Ойын механикасын тексеру (тапсырма профилі)",
  history: "Тарихи тапсырмаларды тексеру",
  auth: "Аутентификация мен сақталған нәтижелерді тексеру",
  responsive: "Адаптивті дизайнды тексеру",
  security: "Қауіпсіздікті тексеру",
  repo: "Репозиторийді статикалық талдау",
  scoring: "Ұпайды есептеу және есеп дайындау",
};

export function makeStages(): JobStage[] {
  return STAGE_KEYS.map((k) => ({ key: k, label: STAGE_LABELS[k], status: "pending" as const }));
}

export interface ExecutorResult {
  tests: TestResult[];
  securityWarnings: string[];
  historicalNotes: string[];
  limitations: string[];
  finalUrl?: string;
  httpStatus?: number;
  consoleErrors: string[];
  failedRequests: string[];
  blockedRequests: string[];
  detectedText: string; // табылған мәтін (тарихи мазмұн талдауы үшін)
  loadFailed: boolean;
}

interface Ctx {
  res: ExecutorResult;
  rec: EvaluationRecord;
  profileKey: string;
  pageText: string;
  screenshotCount: number;
}

const SECRET_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /AKIA[0-9A-Z]{16}/g, label: "AWS access key" },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, label: "жеке кілт (private key)" },
  { re: /ghp_[A-Za-z0-9]{36}/g, label: "GitHub personal access token" },
  { re: /sk-[A-Za-z0-9]{20,}/g, label: "API құпия кілті (secret key)" },
  { re: /ya29\.[A-Za-z0-9_-]{20,}/g, label: "Google OAuth токені" },
  { re: /AIza[0-9A-Za-z_-]{35}/g, label: "Google API кілті" },
];

function newTest(requirementId: string, name: string): TestResult {
  return {
    id: randomUUID().slice(0, 8),
    requirementId,
    name,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    actions: [],
    expected: "",
    actual: "",
    status: "NOT_VERIFIED",
    scoreImpact: "",
  };
}

function finish(t: TestResult, status: TestStatus, actual: string, extra: Partial<TestResult> = {}): TestResult {
  t.status = status;
  t.actual = actual;
  t.finishedAt = new Date().toISOString();
  Object.assign(t, extra);
  return t;
}

async function takeScreenshot(page: Page, ctx: Ctx, name: string): Promise<string | undefined> {
  try {
    ctx.screenshotCount++;
    const dir = path.join(CONFIG.evidenceDir, ctx.rec.id);
    await fs.mkdir(dir, { recursive: true });
    const fname = `${String(ctx.screenshotCount).padStart(2, "0")}-${name}.png`;
    await page.screenshot({ path: path.join(dir, fname), fullPage: false });
    return `${ctx.rec.id}/${fname}`;
  } catch (e) {
    return undefined;
  }
}

function containsAny(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((k) => lower.includes(k.toLowerCase()));
}

/** Ашық қалған модаль терезелерді жабу (кейінгі әрекеттердің кедергісін болдырмау). */
async function closeOpenModals(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const closeBtn = page
        .locator(".modal:visible button:visible, [class*='modal' i]:visible button:visible, [role='dialog']:visible button:visible")
        .filter({ hasText: /^жоқ|^жабу|^close|^×$|^x$|болдырмау/i })
        .first();
      if (await closeBtn.count()) {
        await closeBtn.click({ timeout: 1500 });
        await page.waitForTimeout(300);
        continue;
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      const stillOpen = await page.locator(".modal:visible, [role='dialog']:visible").count();
      if (!stillOpen) break;
    } catch { /* модаль жабылмаса — әрі қарай жалғастырамыз */ }
  }
}

async function safeInnerText(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => document.body?.innerText ?? "");
  } catch {
    return "";
  }
}

export async function runBrowserTests(
  rec: EvaluationRecord,
  assignmentId: string,
  requirements: Requirement[],
  onStage: (key: string, status: JobStage["status"]) => Promise<void>,
): Promise<ExecutorResult> {
  const assignment = { A1: "action_arcade_survival", A2: "strategy_tower_defense", A3: "shooter_quiz", A4: "racing_quiz", A5: "match3_puzzle_rpg", A6: "adventure_escape" }[assignmentId] ?? "action_arcade_survival";
  const res: ExecutorResult = {
    tests: [],
    securityWarnings: [],
    historicalNotes: [],
    limitations: [],
    consoleErrors: [],
    failedRequests: [],
    blockedRequests: [],
    detectedText: "",
    loadFailed: false,
  };
  const ctx: Ctx = { res, rec, profileKey: assignment, pageText: "", screenshotCount: 0 };
  const profile = PROFILES[assignment];
  const opts = { allowLocalhostForTests: CONFIG.allowLocalhostForTests };

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    // ===== 1. VALIDATE =====
    await onStage("validate", "running");
    const check = await validateUrl(rec.projectUrl, opts);
    const tVal = newTest("C-SEC-AUTH", "Сілтеменің жарамдылығы мен SSRF сүзгісі");
    tVal.actions.push(`URL тексерілді: ${rec.projectUrl}`);
    tVal.expected = "Сілтеме http/https және жеке/ішкі мекенжай емес";
    if (!check.ok) {
      finish(tVal, "BLOCKED", check.reason ?? "Тексеруден өтпеді", { limitations: "SSRF қорғанысы сілтемені бұғаттады — сайт ашылмады." });
      res.tests.push(tVal);
      res.loadFailed = true;
      await onStage("validate", "error");
      return res;
    }
    finish(tVal, "PASS", `Сілтеме рұқсат етілген аймақта${check.resolvedIps ? `, DNS: ${check.resolvedIps.join(", ")}` : ""}`);
    res.tests.push(tVal);
    await onStage("validate", "done");
    if (rec.cancelRequested) return res;

    // ===== Браузерді іске қосу =====
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: "GameHubAuditor/1.0 (университеттік автоматты тексеру)",
      locale: "kk-KZ",
    });
    context.setDefaultTimeout(CONFIG.pageActionTimeoutMs);

    let requestCount = 0;
    await context.route("**/*", async (route) => {
      requestCount++;
      if (requestCount > CONFIG.maxNetworkRequests) {
        await route.abort();
        return;
      }
      try {
        const host = new URL(route.request().url()).hostname;
        if (!isRequestHostAllowed(host, opts)) {
          res.blockedRequests.push(route.request().url());
          await route.abort();
          return;
        }
      } catch {
        /* URL талдау қатесі — сұранысты жібермейміз */
        await route.abort();
        return;
      }
      await route.continue();
    });

    page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") res.consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on("pageerror", (err) => res.consoleErrors.push(String(err.message).slice(0, 300)));
    page.on("requestfailed", (req) => res.failedRequests.push(`${req.url().slice(0, 200)} (${req.failure()?.errorText ?? "белгісіз"})`));

    // ===== 2. LOAD =====
    await onStage("load", "running");
    const tLoad = newTest("C-HUB-MAIN", "Сайттың қолжетімділігі мен жүктелуі");
    tLoad.browser = "Chromium (headless)";
    tLoad.viewport = "1366×768";
    tLoad.actions.push(`goto(${check.finalUrl})`);
    tLoad.expected = "Сайт ашылады, HTTP 2xx/3xx жауабы, мазмұн көрінеді";
    try {
      const resp = await page.goto(check.finalUrl!, { waitUntil: "domcontentloaded", timeout: CONFIG.navTimeoutMs });
      res.httpStatus = resp?.status();
      res.finalUrl = page.url();
      const redirects = resp ? resp.request().redirectedFrom() !== null : false;
      tLoad.actions.push(`HTTP күйі: ${res.httpStatus ?? "жауап жоқ"}; соңғы URL: ${res.finalUrl}${redirects ? " (редирект арқылы)" : ""}`);
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
      const text = await safeInnerText(page);
      ctx.pageText = text;
      res.detectedText = text;
      const visibleLen = text.trim().length;
      const isErrorPage = /\b(404|403|500|502|503)\b/.test(text.slice(0, 200)) && visibleLen < 300;
      const shot = await takeScreenshot(page, ctx, "basty-bet");
      if ((res.httpStatus ?? 0) >= 500 || isErrorPage) {
        finish(tLoad, "FAIL", `Сервер қатесі: HTTP ${res.httpStatus}, бет мазмұны: «${text.slice(0, 120)}»`, { screenshot: shot });
      } else if ((res.httpStatus ?? 0) >= 400) {
        finish(tLoad, "FAIL", `HTTP ${res.httpStatus} — бет қолжетімсіз`, { screenshot: shot });
      } else if (visibleLen < 20 && !(await page.locator("canvas").count())) {
        finish(tLoad, "FAIL", "Бет бос немесе мазмұны жоқ (көрінетін мәтін мен canvas табылмады)", { screenshot: shot });
      } else {
        finish(tLoad, "PASS", `HTTP ${res.httpStatus}; көрінетін мәтін: ${visibleLen} таңба; соңғы URL: ${res.finalUrl}`, { screenshot: shot });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      finish(tLoad, "FAIL", `Сайт ашылмады: ${msg.slice(0, 250)}`, { error: msg.slice(0, 500) });
      res.loadFailed = true;
    }
    res.tests.push(tLoad);
    await onStage("load", tLoad.status === "FAIL" && res.loadFailed ? "error" : "done");
    if (res.loadFailed || !page) {
      // Сайт ашылмаса, браузерлік кезеңдер орындалмайды — бәрі BLOCKED
      for (const key of ["ui", "mechanics", "history", "auth", "responsive", "security"]) {
        const t = newTest("C-HUB-MAIN", `${STAGE_LABELS[key]} — сайт қолжетімсіз`);
        finish(t, "BLOCKED", "Сайт жүктелмеді — кезең орындалмады", { limitations: "Негізгі бет ашылмағандықтан тексеру мүмкін болмады." });
        res.tests.push(t);
        await onStage(key, "skipped");
      }
      return res;
    }
    if (rec.cancelRequested) return res;

    // ===== 3. UI =====
    await onStage("ui", "running");
    const buttons = await page.locator("button:visible, [role='button']:visible, a.btn:visible").count();
    const links = await page.locator("a[href]:visible").count();
    const inputs = await page.locator("input:visible, textarea:visible, select:visible").count();
    const tUi = newTest("C-HUB-PAGES", "Интерфейс элементтері мен навигация");
    tUi.actions.push(`Көрінетін батырмалар: ${buttons}; сілтемелер: ${links}; енгізу өрістері: ${inputs}`);
    tUi.expected = "Пайдаланушы басқаратын элементтер бар және навигация жұмыс істейді";
    // Навигацияны сынау: көрінетін ішкі сілтемелердің біреуін басып, қайту
    let navWorked: boolean | null = null;
    const internalLink = page.locator("a[href]:visible").first();
    if (links > 0) {
      try {
        const href = await internalLink.getAttribute("href");
        await Promise.all([page.waitForNavigation({ timeout: 6000 }).catch(() => undefined), internalLink.click({ timeout: 4000 })]);
        navWorked = page.url() !== res.finalUrl || (await safeInnerText(page)) !== ctx.pageText;
        await page.goBack({ timeout: 6000 }).catch(() => undefined);
        ctx.pageText = await safeInnerText(page);
        tUi.actions.push(`Ішкі сілтеме басылды (${href}) → навигация ${navWorked ? "жұмыс істеді" : "өзгеріссіз"}`);
      } catch {
        navWorked = false;
        tUi.actions.push("Сілтемені басу сәтсіз аяқталды");
      }
    }
    const shotUi = await takeScreenshot(page, ctx, "interfeis");
    if (buttons + links + inputs === 0) {
      finish(tUi, "FAIL", "Бетте басқару элементтері табылмады", { screenshot: shotUi });
    } else if (navWorked === false) {
      finish(tUi, "PARTIAL", `Элементтер бар (батырма: ${buttons}), бірақ навигация күй өзгерісін тудырмады`, { screenshot: shotUi });
    } else {
      finish(tUi, "PASS", `Батырмалар: ${buttons}, сілтемелер: ${links}, өрістер: ${inputs}${navWorked ? "; навигация жұмыс істейді" : ""}`, { screenshot: shotUi });
    }
    res.tests.push(tUi);

    // Ойынды бастау батырмасын табу және басу
    const mechReqId = ({ A1: "A1-MECH", A2: "A2-MAP", A3: "A3-TARGETS", A4: "A4-RACE", A5: "A5-MATCH", A6: "A6-PUZZLES" } as Record<string, string>)[assignmentId] ?? `${assignmentId}-MECH`;
    const tStart = newTest(mechReqId, "Ойынды бастау әрекеті");
    tStart.actions.push("«Бастау/Ойнау» тәрізді батырма ізделді");
    tStart.expected = "Ойын басталады: күй өзгереді (жаңа экран/canvas/ұпай)";
    const startBtn = page.locator("button:visible, [role='button']:visible").filter({ hasText: /бастау|ойнау|ойын|start|play|баста/i }).first();
    let startClicked = false;
    try {
      if (await startBtn.count()) {
        const before = await safeInnerText(page);
        await startBtn.click({ timeout: 4000 });
        startClicked = true;
        await page.waitForTimeout(1500);
        const after = await safeInnerText(page);
        const canvasCount = await page.locator("canvas:visible").count();
        tStart.actions.push("Бастау батырмасы басылды; 1.5 сек күтілді; күй салыстырылды");
        const shotStart = await takeScreenshot(page, ctx, "oyin-bastau");
        if (after !== before || canvasCount > 0) {
          finish(tStart, "PASS", `Күй өзгерді${canvasCount ? `; canvas элементтері: ${canvasCount}` : ""}`, { screenshot: shotStart });
        } else {
          finish(tStart, "FAIL", "Батырма басылды, бірақ ешқандай күй өзгерісі байқалмады", { screenshot: shotStart });
        }
      } else {
        finish(tStart, "NOT_VERIFIED", "Бастау батырмасы табылмады — ойынның басталуы тексерілмеді", { limitations: "Бетте «бастау/ойнау» мәтінді батырма жоқ; ойын басқаша басталуы мүмкін." });
      }
    } catch (e) {
      finish(tStart, startClicked ? "FAIL" : "BLOCKED", `Бастау әрекеті қатемен аяқталды: ${String(e).slice(0, 150)}`, { error: String(e).slice(0, 300) });
    }
    res.tests.push(tStart);
    ctx.pageText = await safeInnerText(page);
    res.detectedText = ctx.pageText;
    await onStage("ui", "done");
    if (rec.cancelRequested) return res;

    // ===== 4. MECHANICS (профиль бойынша) =====
    await onStage("mechanics", "running");
    await checkCharacters(page, ctx, profile, assignmentId);
    await checkLevels(page, ctx, profile, assignmentId);
    await checkCoreMechanics(page, ctx, profile, assignmentId);
    await onStage("mechanics", "done");
    if (rec.cancelRequested) return res;

    // ===== 5. HISTORY TASKS =====
    await onStage("history", "running");
    await checkTaskTypes(page, ctx);
    await checkLivesMechanic(page, ctx, assignmentId);
    // Тарихи дәлдік — жауаптар кілті болса ғана
    const tHist = newTest("C-HIST-ACC", "Тарихи контенттің дәлдігі");
    const key = await loadAnswerKey();
    if (key && ctx.pageText.length > 0) {
      const matches = compareAgainstKey(ctx.pageText, key);
      const found = matches.filter((m) => m.foundInPage);
      const correct = found.filter((m) => m.correct === true).length;
      const wrong = found.filter((m) => m.correct === false).length;
      tHist.actions.push(`Жауаптар кілтімен салыстырылды: ${key.length} жазба, беттен ${found.length} сұрақ табылды`);
      tHist.expected = "Табылған сұрақ-жауаптар кілтке сәйкес";
      if (found.length === 0) {
        finish(tHist, "NOT_VERIFIED", "Бет мәтінінен кілттегі сұрақтар табылмады");
      } else if (wrong === 0) {
        finish(tHist, "PASS", `${found.length} сұрақ табылды, ${correct}-і дұрыс жауаппен`);
      } else {
        finish(tHist, "FAIL", `${wrong} сұрақтың жауабы кілтке сәйкес келмеді`);
      }
      res.historicalNotes.push(...found.map((m) => `«${m.question}» — күтілетін жауап: ${m.expectedAnswer}; бетте: ${m.correct === null ? "анықталмады" : m.correct ? "сәйкес" : "сәйкес емес"}`));
    } else {
      finish(tHist, "NOT_VERIFIED", "Бекітілген жауаптар кілті (data/answer_key.json) жоқ — автоматты салыстыру мүмкін емес", {
        limitations: "Тарихи дәлдік оқытушының қолмен тексеруін қажет етеді. Табылған сұрақ мазмұны есепке «Алдын ала АИ бағалауы» бөліміне жазылады.",
      });
      const qLike = ctx.pageText.match(/[^.\n]{10,120}\?/g)?.slice(0, 5) ?? [];
      if (qLike.length) res.historicalNotes.push("Беттен табылған сұрақтар (оқытушы тексеруіне): " + qLike.join(" | "));
    }
    res.tests.push(tHist);
    await onStage("history", "done");
    if (rec.cancelRequested) return res;

    // ===== 6. AUTH =====
    await onStage("auth", "running");
    await checkGoogleAuth(page, ctx);
    await onStage("auth", "done");
    if (rec.cancelRequested) return res;

    // ===== 7. RESPONSIVE =====
    await onStage("responsive", "running");
    await checkResponsive(page, context, ctx);
    await onStage("responsive", "done");
    if (rec.cancelRequested) return res;

    // ===== 8. SECURITY =====
    await onStage("security", "running");
    await checkSecurity(page, ctx);
    await onStage("security", "done");

    // ===== 9. REPO =====
    await onStage("repo", "running");
    await checkRepo(ctx);
    await onStage("repo", "done");

    // Консоль қателері — жеке тест
    const tConsole = newTest("C-CODE", "JavaScript консоль қателері мен сәтсіз сұраныстар");
    tConsole.expected = "Консольде қате жоқ; желілік сұраныстар сәтті";
    tConsole.actions.push(`Консоль қателері: ${res.consoleErrors.length}; сәтсіз сұраныстар: ${res.failedRequests.length}`);
    const consoleShot = await takeScreenshot(page, ctx, "konsol-kuyi");
    if (res.consoleErrors.length === 0 && res.failedRequests.length === 0) {
      finish(tConsole, "PASS", "Қателер тіркелмеді", { screenshot: consoleShot });
    } else if (res.consoleErrors.length <= 2 && res.failedRequests.length === 0) {
      finish(tConsole, "PARTIAL", `Аздаған консоль қателері: ${res.consoleErrors.slice(0, 2).join(" | ")}`, { screenshot: consoleShot });
    } else {
      finish(tConsole, "FAIL", `Консоль қателері: ${res.consoleErrors.length}; сәтсіз сұраныстар: ${res.failedRequests.length}. Мысал: ${(res.consoleErrors[0] ?? res.failedRequests[0] ?? "").slice(0, 150)}`, { screenshot: consoleShot });
    }
    res.tests.push(tConsole);
    return res;
  } finally {
    // Ресурстарды міндетті түрде босату
    try { await page?.close(); } catch { /* already closed */ }
    try { await context?.close(); } catch { /* already closed */ }
    try { await browser?.close(); } catch { /* already closed */ }
  }
}

// ---------- Көмекші тексерулер ----------

async function checkCharacters(page: Page, ctx: Ctx, profile: (typeof PROFILES)[string], assignmentId: string): Promise<void> {
  const t = newTest(`${assignmentId}-CHARS`, "Кейіпкерлер жүйесі (10 кейіпкер)");
  t.expected = `PDF бойынша ${profile.expectedCharacters} кейіпкер/тұлға таңдауға қолжетімді`;
  const text = await safeInnerText(page);
  const found = containsAny(text, profile.characters);
  t.actions.push(`Бет мәтінінен ізделді: ${profile.characters.join(", ")}`);
  t.actions.push(`Табылды (${found.length}): ${found.join(", ") || "ештеңе"}`);
  // Кейіпкер таңдау экраны болуы мүмкін — батырмаларды іздеу
  const selectBtn = page.locator("button:visible, [role='button']:visible, a:visible").filter({ hasText: /кейіпкер|таңдау|таңда/i }).first();
  if (found.length === 0 && (await selectBtn.count())) {
    try {
      await selectBtn.click({ timeout: 4000 });
      await page.waitForTimeout(800);
      const text2 = await safeInnerText(page);
      const found2 = containsAny(text2, profile.characters);
      if (found2.length > found.length) {
        found.push(...found2.filter((f) => !found.includes(f)));
        t.actions.push(`Таңдау экраны ашылды; қосымша табылды (${found2.length}): ${found2.join(", ")}`);
      }
    } catch { /* батырма жұмыс істемеді — жоғарыдағы нәтиже сақталады */ }
  }
  const shot = await takeScreenshot(page, ctx, `keipkerler-${assignmentId}`);
  if (found.length >= profile.expectedCharacters) {
    finish(t, "PASS", `${profile.expectedCharacters}+ кейіпкер табылды: ${found.join(", ")}`, { screenshot: shot });
  } else if (found.length > 0) {
    finish(t, "PARTIAL", `Тек ${found.length}/${profile.expectedCharacters} кейіпкер табылды: ${found.join(", ")}`, { screenshot: shot });
  } else {
    finish(t, "FAIL", "Кейіпкер атаулары беттен табылмады", { screenshot: shot });
  }
  ctx.res.tests.push(t);
}

async function checkLevels(page: Page, ctx: Ctx, profile: (typeof PROFILES)[string], assignmentId: string): Promise<void> {
  const t = newTest(`${assignmentId}-LEVELS`, "Кезеңдер/деңгейлер жүйесі");
  t.expected = `PDF бойынша ${profile.expectedLevels} кезең/деңгей/арена болуы керек`;
  const text = await safeInnerText(page);
  const found = containsAny(text, profile.levels);
  t.actions.push(`Кезең кілт сөздері ізделді; табылды (${found.length}): ${found.join(", ") || "ештеңе"}`);
  // «10 кезең», «10 деңгей», «деңгей 10» тәрізді сандық дәлел
  const numeric = /(?:10\s*(?:кезең|деңгей|арена|трасса|бөлме))|(?:(?:кезең|деңгей|арена|трасса|бөлме)\s*[:\-–]?\s*10\b)/i.test(text);
  const levelLinks = await page.locator("[class*='level' i]:visible, [class*='kez' i]:visible, [data-level]:visible").count();
  t.actions.push(`Сандық дәлел (10 кезең мәтіні): ${numeric ? "бар" : "жоқ"}; деңгей элементтері: ${levelLinks}`);
  const shot = await takeScreenshot(page, ctx, `kezender-${assignmentId}`);
  const evidence = found.length + (numeric ? 3 : 0) + Math.min(levelLinks, 5);
  if (found.length >= 5 || (numeric && levelLinks >= 5)) {
    finish(t, "PASS", `Кезеңдер жүйесінің дәлелі: ${found.length} тақырып${numeric ? ", «10 кезең» мәтіні" : ""}${levelLinks ? `, ${levelLinks} деңгей элементі` : ""}`, { screenshot: shot });
  } else if (evidence > 0) {
    finish(t, "PARTIAL", `Кезеңдердің бір бөлігі ғана табылды (${found.length} тақырып, ${levelLinks} элемент) — толық ${profile.expectedLevels} кезең дәлелденбеді`, { screenshot: shot });
  } else {
    finish(t, "FAIL", "Кезең/деңгей жүйесінің дәлелі табылмады", { screenshot: shot });
  }
  ctx.res.tests.push(t);

  // Қиындық жүйесі (C-DIFF): кезеңдер біркелкі жеңіл болмауы керек
  const tDiff = newTest("C-DIFF", "Қиындық жүйесі (10 кезең, 10-кезең — BOSS)");
  tDiff.expected = "Кезеңдер арасында қиындық айырмашылығы бар (жұлдызшалар/BOSS/сипаттама)";
  const diffKeywords = containsAny(text, ["⭐", "BOSS", "босс", "қиындық", "қарапайым", "күрделі", "жеңіл"]);
  tDiff.actions.push(`Қиындық белгілері ізделді; табылды (${diffKeywords.length}): ${diffKeywords.join(", ") || "ештеңе"}`);
  tDiff.actions.push(`Деңгей таңдау элементтері: ${levelLinks}`);
  if (diffKeywords.length >= 2 && levelLinks >= 3) {
    finish(tDiff, "PARTIAL", `Қиындық белгілері бар (${diffKeywords.join(", ")}), бірақ барлық 10 кезеңнің нақты қиындауы автоматты дәлелденбеді`, { screenshot: shot, limitations: "Кезеңдерді толық ойнап шығу автоматты мүмкін емес." });
  } else if (levelLinks >= 5) {
    finish(tDiff, "NOT_VERIFIED", "Кезеңдер бар, бірақ қиындық айырмашылығының дәлелі табылмады", { limitations: "Қиындық жүйесін оқытушы қорғау кезінде тексеруі керек." });
  } else {
    finish(tDiff, "FAIL", "Қиындық жүйесінің дәлелі табылмады (кезеңдер біркелкі болуы мүмкін)");
  }
  ctx.res.tests.push(tDiff);
}

async function checkCoreMechanics(page: Page, ctx: Ctx, profile: (typeof PROFILES)[string], assignmentId: string): Promise<void> {
  const reqId = { A1: "A1-MECH", A2: "A2-MAP", A3: "A3-TARGETS", A4: "A4-RACE", A5: "A5-MATCH", A6: "A6-PUZZLES" }[assignmentId] ?? `${assignmentId}-MECH`;
  const t = newTest(reqId, "Негізгі ойын механикасының жұмысы");
  t.expected = "Ойын механикасы нақты әрекетке жауап береді (күй/ұпай өзгереді)";
  const text = await safeInnerText(page);
  const found = containsAny(text, profile.mechanics);
  t.actions.push(`Механика кілт сөздері: ${found.length} табылды (${found.slice(0, 6).join(", ")})`);
  const canvas = page.locator("canvas:visible").first();
  const canvasCount = await page.locator("canvas:visible").count();
  let interactionEvidence = "";
  if (canvasCount > 0 && profile.keyboardDriven) {
    try {
      await canvas.click({ timeout: 3000 }).catch(() => undefined);
      for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Space"]) {
        await page.keyboard.press(key === " " ? "Space" : key);
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(800);
      const after = await safeInnerText(page);
      interactionEvidence = after !== text ? "пернелерге реакция: күй өзгерді" : "пернелер жіберілді, мәтіндік күй өзгермеді (canvas ішкі күйі сырттан көрінбеуі мүмкін)";
      t.actions.push("Canvas басылып, бағыт пернелері жіберілді");
    } catch (e) {
      interactionEvidence = `әрекет қатесі: ${String(e).slice(0, 100)}`;
    }
  } else if (canvasCount > 0) {
    try {
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 3, box.y + box.height / 2);
        await page.waitForTimeout(300);
        await page.mouse.click(box.x + (box.width * 2) / 3, box.y + box.height / 2);
        await page.waitForTimeout(800);
        const after = await safeInnerText(page);
        interactionEvidence = after !== text ? "canvas-та нұқуға реакция бар" : "canvas бар, бірақ сыртқы күй өзгерісі байқалмады";
        t.actions.push("Canvas элементіне екі нұқу жасалды");
      }
    } catch { interactionEvidence = "canvas әрекеті орындалмады"; }
  } else {
    interactionEvidence = "canvas табылмады — DOM негізіндегі ойын болуы мүмкін";
  }
  t.actions.push(interactionEvidence);
  const shot = await takeScreenshot(page, ctx, `mehanika-${assignmentId}`);
  if (found.length >= 3 && interactionEvidence.includes("өзгерді")) {
    finish(t, "PASS", `Механика дәлелденді: ${found.length} кілт сөз, ${interactionEvidence}`, { screenshot: shot });
  } else if (found.length >= 2 || canvasCount > 0) {
    finish(t, "PARTIAL", `Механика белгілері бар (${found.length} кілт сөз, canvas: ${canvasCount}), толық жұмысы дәлелденбеді: ${interactionEvidence}`, { screenshot: shot });
  } else {
    finish(t, "FAIL", "Негізгі механиканың дәлелі табылмады", { screenshot: shot });
  }
  ctx.res.tests.push(t);
}

async function checkTaskTypes(page: Page, ctx: Ctx): Promise<void> {
  const text = await safeInnerText(page);
  // Викторина/тапсырма экранын ашуға тырысу
  const quizBtn = page.locator("button:visible, [role='button']:visible, a:visible").filter({ hasText: /тапсырма|сұрақ|викторина|quiz/i }).first();
  if (await quizBtn.count()) {
    try {
      await quizBtn.click({ timeout: 3000 });
      await page.waitForTimeout(600);
    } catch { /* ашылмаса — басты бет мәтінімен шектелеміз */ }
  }
  const quizText = (await safeInnerText(page)) + "\n" + text;
  const shot = await takeScreenshot(page, ctx, "tapsyrmalar");
  let passCount = 0;
  let detectedTypes: string[] = [];
  for (const [reqId, keywords] of Object.entries(TASK_TYPE_KEYWORDS)) {
    const t = newTest(reqId, `Міндетті тапсырма түрі (${reqId.replace("C-TASK-", "")}/6)`);
    const found = containsAny(quizText, keywords);
    t.actions.push(`Кілт сөздер ізделді: ${keywords.join(", ")}`);
    t.expected = "Берілген форматтағы тарихи тапсырма ойында бар";
    if (found.length >= 2) {
      passCount++;
      detectedTypes.push(reqId);
      finish(t, "PARTIAL", `Формат белгілері табылды (${found.join(", ")}), бірақ нақты жұмысы әрекет арқылы дәлелденбеді`, { screenshot: shot });
    } else if (found.length === 1) {
      finish(t, "NOT_VERIFIED", `Тек бір жанама белгі (${found[0]}) — форматтың барлығы дәлелденбеді`, { limitations: "Тапсырма экраны ойын барысында ашылуы мүмкін; автоматты жету мүмкін болмады." });
    } else {
      finish(t, "FAIL", "Берілген тапсырма форматының дәлелі табылмады", { screenshot: shot });
    }
    ctx.res.tests.push(t);
  }
  // Интерактивті дәлел: жауап нұсқасын басып көру (бірінші тапсырма түрі үшін)
  const first = ctx.res.tests.find((x) => x.requirementId === "C-TASK-1" && x.status === "PARTIAL");
  if (first) {
    const option = page.locator("button:visible, [role='button']:visible, label:visible, li:visible").filter({ hasText: /^[ABCD]\)|^А\)|^\d{3,4}$/ }).first();
    try {
      if (await option.count()) {
        const before = await safeInnerText(page);
        await option.click({ timeout: 3000 });
        await page.waitForTimeout(700);
        const after = await safeInnerText(page);
        first.actions.push("Жауап нұсқасы басылды; кері байланыс ізделді");
        if (after !== before) {
          first.status = "PASS";
          first.actual = "Жауап таңдау нақты нәтиже берді (күй өзгерді — кері байланыс/ұпай экраны)";
          first.screenshot = await takeScreenshot(page, ctx, "jauap-basu");
        }
      }
    } catch { /* әрекет сәтсіз — PARTIAL күйі қалады */ }
  }
  ctx.res.detectedText = quizText;
  if (detectedTypes.length < 6) {
    ctx.res.historicalNotes.push(`6 міндетті тапсырма түрінің ${detectedTypes.length}-і ғана анықталды (қалғандары оқытушы тексеруіне ұсынылады).`);
  }
}

async function checkLivesMechanic(page: Page, ctx: Ctx, assignmentId: string): Promise<void> {
  const t = newTest("C-LIVES", "«Жан біткенде» механикасы (тарихи тапсырма арқылы құтқару)");
  t.expected = "Жеңіліс экранында тарихи тапсырма ұсынылады; дұрыс жауап +1 өмір береді";
  const text = await safeInnerText(page) + "\n" + ctx.res.detectedText;
  const found = containsAny(text, LIVES_KEYWORDS);
  t.actions.push(`Кілт сөздер: ${LIVES_KEYWORDS.join(", ")}; табылды: ${found.join(", ") || "ештеңе"}`);
  // Ашық қалған модаль терезе болса — жабу (әрекет кедергісін болдырмау)
  await closeOpenModals(page);
  // Жеңіліс экранына арналған арнайы сынақ батырмасы (fixture) бар ма?
  const loseBtn = page.locator("button:visible, [role='button']:visible").filter({ hasText: /жеңілу|lose|game over|жан бітті|тест: жеңіл/i }).first();
  let verifiedFlow = false;
  if (await loseBtn.count()) {
    try {
      await loseBtn.click({ timeout: 3000 });
      await page.waitForTimeout(800);
      const after = await safeInnerText(page);
      const medicFound = containsAny(after, ["Медициналық көмек", "қажет пе", "құтқара", "тапсырманы орындаңыз", "ЖЕҢІЛДІҢІЗ"]);
      const shot = await takeScreenshot(page, ctx, "zhan-bitkende");
      if (medicFound.length > 0) {
        verifiedFlow = true;
        // «Иә» батырмасын басып тапсырманы ашу
        const yesBtn = page.locator("button:visible").filter({ hasText: /^иә|ия|yes/i }).first();
        if (await yesBtn.count()) {
          await yesBtn.click({ timeout: 3000 }).catch(() => undefined);
          await page.waitForTimeout(600);
          t.actions.push("Жеңіліс экраны → «Иә» басылды → тапсырма экраны тексерілді");
        }
        finish(t, "PASS", `Жеңіліс экранында тапсырма механикасы нақты жұмыс істейтіні дәлелденді (${medicFound.join(", ")})`, { screenshot: shot });
      } else {
        finish(t, "PARTIAL", "Жеңіліс экраны ашылды, бірақ медициналық көмек/тапсырма терезесі табылмады", { screenshot: shot });
      }
    } catch { /* батырма жұмыс істемеді */ }
  }
  if (!verifiedFlow) {
    const shot = await takeScreenshot(page, ctx, "zhan-izdew");
    if (found.length >= 3) {
      finish(t, "PARTIAL", `Механика белгілері бар (${found.join(", ")}), бірақ толық ағын (жеңіліс → тапсырма → +1 өмір) дәлелденбеді`, { screenshot: shot, limitations: "Ойында жеңілу үшін ұзақ ойнау керек; автоматты түрде өмірді таусу мүмкін болмады." });
    } else if (found.length > 0) {
      finish(t, "NOT_VERIFIED", `Тек жанама белгілер (${found.join(", ")}) — механиканың барлығы дәлелденбеді`, { limitations: "Өмір біту сценариіне автоматты жету мүмкін болмады." });
    } else {
      finish(t, "FAIL", "«Жан біткенде» механикасының ешқандай дәлелі табылмады (барлық 6 ойынға міндетті талап)", { screenshot: shot });
    }
  }
  // Терезе ашық қалса — кейінгі кезеңдер үшін жабу
  await closeOpenModals(page);
  ctx.res.tests.push(t);
}

async function checkGoogleAuth(page: Page, ctx: Ctx): Promise<void> {
  const t = newTest("C-GOOGLE", "Google арқылы кіру");
  t.expected = "«Google арқылы кіру» батырмасы бар және аутентификация ағыны жұмыс істейді";
  const text = await safeInnerText(page);
  const found = containsAny(text, GOOGLE_LOGIN_KEYWORDS);
  const loginBtn = page.locator("button:visible, [role='button']:visible, a:visible").filter({ hasText: /google/i }).first();
  const btnExists = (await loginBtn.count()) > 0;
  t.actions.push(`Мәтіннен ізделді: табылды (${found.join(", ") || "ештеңе"}); Google мәтінді элемент: ${btnExists ? "бар" : "жоқ"}`);
  const shot = await takeScreenshot(page, ctx, "google-kiru");
  if (!btnExists && found.length === 0) {
    finish(t, "FAIL", "Google арқылы кіру элементі табылмады (ортақ міндетті талап)", { screenshot: shot });
  } else {
    // Батырманың барлығы — кірудің жұмыс істейтінін дәлелдемейді
    finish(t, "PARTIAL", "Google кіру батырмасы бар, бірақ нақты аутентификация ағыны тексерілмеді", {
      screenshot: shot,
      limitations: "Тесттік Google аккаунты берілмеген — нақты кіру сынағы орындалмады. Батырманың барлығы жұмыс істеуін дәлелдемейді.",
    });
  }
  ctx.res.tests.push(t);

  const tProf = newTest("C-GOOGLE-DATA", "Профильде 7 деректің сақталуы (аты, email, ұпай, деңгей, дұрыс/қате жауап, уақыт)");
  tProf.expected = "Профиль бетінде аталған 7 дерек көрінеді";
  tProf.actions.push("Профиль бетіне автоматты кіру мүмкін емес (аутентификация қажет)");
  finish(tProf, "NOT_VERIFIED", "Аутентификациясыз профиль деректері тексерілмеді", {
    limitations: "Пайдаланушының жеке аккаунтына кіруге рұқсат жоқ. Оқытушы қорғау кезінде студенттен көрсетуді сұрауы керек (PDF: қорғаудың 8-пункті).",
  });
  ctx.res.tests.push(tProf);

  // GAME HUB порталының бөлімдері
  const tHubPages = newTest("C-HUB-PAGES", "GAME HUB порталының 6 бөлімі");
  const hubFound = containsAny(text, HUB_KEYWORDS);
  tHubPages.actions.push(`Портал бөлімдері ізделді; табылды (${hubFound.length}/6): ${hubFound.join(", ") || "ештеңе"}`);
  tHubPages.expected = "Ойындар тізімі, рейтинг, профиль, нәтижелер, әкімші, рейтинг жүйесі бөлімдері бар";
  if (hubFound.length >= 5) finish(tHubPages, "PASS", `${hubFound.length}/6 бөлім табылды: ${hubFound.join(", ")}`, { screenshot: shot });
  else if (hubFound.length >= 2) finish(tHubPages, "PARTIAL", `Тек ${hubFound.length}/6 бөлім табылды: ${hubFound.join(", ")}`, { screenshot: shot });
  else finish(tHubPages, "FAIL", "GAME HUB бөлімдері табылмады", { screenshot: shot });
  ctx.res.tests.push(tHubPages);

  // Рейтинг кестесі
  const tRating = newTest("C-HUB-RATING", "Рейтинг кестесі (Орын/Студент/Ойын/Ұпай/Деңгей)");
  tRating.expected = "Кемінде 5 бағаны бар рейтинг кестесі көрінеді";
  const tables = await page.locator("table:visible").count();
  const ratingKeywords = containsAny(text, ["орын", "рейтинг", "ұпай", "деңгей"]);
  tRating.actions.push(`Кестелер: ${tables}; рейтинг кілт сөздері: ${ratingKeywords.join(", ") || "жоқ"}`);
  const shotR = await takeScreenshot(page, ctx, "reiting");
  if (tables > 0 && ratingKeywords.length >= 2) finish(tRating, "PARTIAL", "Кесте және рейтинг белгілері бар; бағандардың толықтығы мен деректердің сақталуы дәлелденбеді", { screenshot: shotR, limitations: "Кестенің көрінуі нәтижелердің шынымен сақталатынын дәлелдемейді." });
  else if (ratingKeywords.length >= 3) finish(tRating, "PARTIAL", "Рейтинг мәтіні бар, бірақ кесте табылмады", { screenshot: shotR });
  else finish(tRating, "FAIL", "Рейтинг кестесі табылмады", { screenshot: shotR });
  ctx.res.tests.push(tRating);
}

const VIEWPORTS = [
  { width: 390, height: 844, name: "telefon-390x844" },
  { width: 768, height: 1024, name: "planshet-768x1024" },
  { width: 1366, height: 768, name: "noutbuk-1366x768" },
];

async function checkResponsive(page: Page, context: BrowserContext, ctx: Ctx): Promise<void> {
  const t = newTest("C-RESP", "Адаптивті дизайн (3 өлшем)");
  t.expected = "390×844, 768×1024, 1366×768 өлшемдерінде көлденең тасқын жоқ, мазмұн көрінеді";
  const problems: string[] = [];
  const shots: string[] = [];
  for (const vp of VIEWPORTS) {
    t.viewport = `${vp.width}×${vp.height}`;
    t.actions.push(`Viewport орнатылды: ${vp.width}×${vp.height}`);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(500);
    const metrics = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      textLen: document.body?.innerText?.trim().length ?? 0,
      canvasCount: document.querySelectorAll("canvas").length,
    }));
    const shot = await takeScreenshot(page, ctx, vp.name);
    if (shot) shots.push(shot);
    if (metrics.scrollW > metrics.clientW + 1) {
      problems.push(`${vp.width}px: көлденең тасқын ${metrics.scrollW - metrics.clientW}px`);
    }
    if (metrics.textLen < 10 && metrics.canvasCount === 0) {
      problems.push(`${vp.width}px: мазмұн көрінбейді`);
    }
    t.actions.push(`${vp.width}px — тасқын: ${metrics.scrollW - metrics.clientW}px, мәтін: ${metrics.textLen} таңба`);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  if (problems.length === 0) {
    finish(t, "PASS", "Үш өлшемде де көлденең тасқын жоқ, мазмұн көрінеді", { screenshot: shots[0] });
  } else if (problems.length === 1) {
    finish(t, "PARTIAL", `Бір өлшемде мәселе: ${problems[0]}`, { screenshot: shots[0] });
  } else {
    finish(t, "FAIL", `Адаптивтілік мәселелері: ${problems.join("; ")}`, { screenshot: shots[0] });
  }
  ctx.res.tests.push(t);
}

async function checkSecurity(page: Page, ctx: Ctx): Promise<void> {
  // HTTPS
  const tHttps = newTest("C-SEC-AUTH", "HTTPS қолданылуы");
  const isHttps = (ctx.res.finalUrl ?? "").startsWith("https://");
  tHttps.actions.push(`Соңғы URL: ${ctx.res.finalUrl}`);
  tHttps.expected = "Сайт HTTPS арқылы беріледі";
  finish(tHttps, isHttps ? "PASS" : "FAIL", isHttps ? "HTTPS расталды" : "Сайт HTTP арқылы жұмыс істейді (міндетті HTTPS талабы бұзылған)", {});
  ctx.res.tests.push(tHttps);
  if (!isHttps) ctx.res.securityWarnings.push("Сайт HTTPS-ті қолданбайды — деректер ашық арнада беріледі.");

  // Клиенттік құпияларды сканерлеу
  const tSecrets = newTest("C-SEC-CLIENT", "Клиенттік кодтағы құпия кілттер");
  tSecrets.expected = "Бет коды мен скрипттерде құпия кілттер жоқ";
  let html = "";
  try { html = await page.content(); } catch { /* бет жабылған */ }
  const findings: string[] = [];
  for (const { re, label } of SECRET_PATTERNS) {
    const matches = html.match(re);
    if (matches) findings.push(`${label}: ${matches.length} дана`);
  }
  tSecrets.actions.push("Бет HTML мазмұны құпия кілт үлгілеріне сканерленді (6 үлгі)");
  if (findings.length === 0) {
    finish(tSecrets, "PASS", "Құпия кілт үлгілері табылмады");
  } else {
    finish(tSecrets, "FAIL", `Табылды: ${findings.join("; ")}`);
    ctx.res.securityWarnings.push(`Клиенттік кодта құпия кілт іздері: ${findings.join("; ")}. Кілттерді сервер жағына көшіріңіз.`);
  }
  ctx.res.tests.push(tSecrets);

  // SSRF-бұғатталған сұраныстар туралы ескерту
  if (ctx.res.blockedRequests.length > 0) {
    ctx.res.securityWarnings.push(`Бет ${ctx.res.blockedRequests.length} сұранысты ішкі/тыйым салынған мекенжайға жіберуге тырысты (бұғатталды).`);
  }

  // Input validation / XSS сынағы (қауіпсіз, бұзбайтын зонд)
  const tXss = newTest("C-SEC-AUTH", "Енгізу өрістерінің қауіпсіздігі (XSS сынағы)");
  tXss.expected = "Енгізілген HTML/скрипт бетте орындалмайды";
  const textInputs = page.locator("input[type='text']:visible, input:not([type]):visible, textarea:visible");
  const inputCount = Math.min(await textInputs.count(), 3);
  if (inputCount > 0) {
    let probed = 0;
    let xssFired = false;
    for (let i = 0; i < inputCount && !xssFired; i++) {
      try {
        const input = textInputs.nth(i);
        await input.fill("<img src=x onerror=window.__ghaXss=1>");
        probed++;
        // «Жіберу/тексеру» тәрізді батырмаларды басу (форманы аяқтау; барлық үміткерлер)
        const submitBtns = page.locator("button:visible").filter({ hasText: /жіберу|тексеру|submit|send|іздеу|сақтау/i });
        const submitCount = Math.min(await submitBtns.count(), 3);
        for (let s = 0; s < submitCount; s++) {
          await submitBtns.nth(s).click({ timeout: 1500 }).catch(() => undefined);
        }
        await page.keyboard.press("Enter").catch(() => undefined);
        await page.waitForTimeout(300);
        xssFired = await page.evaluate(() => (window as unknown as { __ghaXss?: number }).__ghaXss === 1);
      } catch { /* өріске жазу мүмкін болмады — келесісін сынаймыз */ }
    }
    tXss.actions.push(`${probed} мәтін өрісіне қауіпсіз XSS-зонд енгізіліп, жіберу батырмалары басылды`);
    if (xssFired) {
      finish(tXss, "FAIL", "Енгізілген скрипт орындалды — XSS осалдығы расталды");
      ctx.res.securityWarnings.push("XSS осалдығы: енгізу өрісіне жазылған скрипт орындалды. Input sanitization қосыңыз.");
    } else if (probed > 0) {
      finish(tXss, "PARTIAL", `${probed} өріс тексерілді — скрипт орындалмады; барлық өрістер қамтылмады`, { limitations: `Тек алғашқы ${probed} көрінетін мәтін өрісі тексерілді.` });
    } else {
      finish(tXss, "NOT_VERIFIED", "Өрістерге жазу мүмкін болмады");
    }
  } else {
    finish(tXss, "NOT_VERIFIED", "Мәтін енгізу өрістері табылмады", { limitations: "Енгізу тексеруін автоматты сынау мүмкін болмады." });
  }
  ctx.res.tests.push(tXss);

  // Ұпай манипуляциясының қауіп белгілері
  let localStorageInfo = "";
  try {
    localStorageInfo = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      return keys.join(", ");
    });
  } catch { /* қолжетімсіз */ }
  if (/score|ұпай|points/i.test(localStorageInfo)) {
    ctx.res.securityWarnings.push("Ұпай localStorage-де сақталады — клиент жағынан өзгертуге осал болуы мүмкін (leaderboard manipulation тәуекелі). Серверлік тексеру қажет.");
  }
}

async function checkRepo(ctx: Ctx): Promise<void> {
  const tRepo = newTest("C-SEC-REPO", "GitHub репозиторийінде құпия кілттердің болмауы");
  const tCode = newTest("C-CODE", "Репозиторий сапасы (README, құрылым)");
  const repo = ctx.rec.repositoryUrl?.trim();
  if (!repo) {
    finish(tRepo, "NOT_VERIFIED", "Репозиторий сілтемесі берілмеді", { limitations: "Студент репозиторий бермеген — статикалық талдау мүмкін емес." });
    finish(tCode, "NOT_VERIFIED", "Репозиторийсіз код сапасы тексерілмеді", { limitations: "Оқытушы қорғау кезінде бағалауы керек (қорғаудың 11–12 пункттері)." });
  } else {
    const m = repo.match(/github\.com[/:]([^/]+)\/([^/\s#?]+)/i);
    tRepo.actions.push(`Репозиторий: ${repo}`);
    if (!m) {
      finish(tRepo, "NOT_VERIFIED", "Сілтеме GitHub репозиторийіне ұқсамайды — автоматты талдау қолдамайды", { limitations: "Тек github.com сілтемелері статикалық талданады." });
      finish(tCode, "NOT_VERIFIED", "GitHub-тан тыс репозиторий талданбады");
    } else {
      const owner = m[1];
      const name = m[2].replace(/\.git$/, "");
      try {
        const resp = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers: { "User-Agent": "GameHubAuditor" } });
        if (resp.status === 404) {
          finish(tRepo, "FAIL", "Репозиторий табылмады (404) немесе жабық", {});
          finish(tCode, "FAIL", "Репозиторий қолжетімсіз");
        } else if (resp.ok) {
          const data = (await resp.json()) as { default_branch?: string; description?: string };
          const branch = data.default_branch ?? "main";
          const treeResp = await fetch(`https://api.github.com/repos/${owner}/${name}/git/trees/${branch}?recursive=1`, { headers: { "User-Agent": "GameHubAuditor" } });
          const tree = treeResp.ok ? ((await treeResp.json()) as { tree?: { path: string; size?: number }[] }) : { tree: [] };
          const files = tree.tree ?? [];
          tRepo.actions.push(`Файлдар тізімі алынды: ${files.length} файл`);
          tCode.actions.push(`Файлдар: ${files.length}; README: ${files.some((f) => /readme/i.test(f.path)) ? "бар" : "жоқ"}`);
          // Ұсақ мәтіндік файлдарды сканерлеу (шектелген)
          const scanTargets = files.filter((f) => /\.(js|ts|json|env|html|md|py|txt)$/i.test(f.path) && (f.size ?? 0) < 120_000).slice(0, 40);
          let secretHits = 0;
          const secretLabels = new Set<string>();
          let envFile = false;
          for (const f of scanTargets) {
            if (/(^|\/)\.env(\.|$)/i.test(f.path)) envFile = true;
            try {
              const raw = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/${branch}/${f.path}`, { headers: { "User-Agent": "GameHubAuditor" } });
              if (!raw.ok) continue;
              const content = await raw.text();
              for (const { re, label } of SECRET_PATTERNS) {
                if (re.test(content)) {
                  secretHits++;
                  secretLabels.add(label);
                }
                re.lastIndex = 0;
              }
            } catch { /* файл оқылмады — ескермейміз */ }
          }
          if (envFile) {
            secretHits++;
            secretLabels.add(".env файлы репозиторийде жарияланған");
          }
          if (secretHits === 0) {
            finish(tRepo, "PASS", `${scanTargets.length} файл сканерленді — құпия кілт табылмады`);
          } else {
            finish(tRepo, "FAIL", `Құпия белгілері: ${[...secretLabels].join("; ")}`);
            ctx.res.securityWarnings.push(`Репозиторийде құпия кілт іздері: ${[...secretLabels].join("; ")}. Кілттерді дереу ауыстырып, тарихтан өшіріңіз.`);
          }
          const hasReadme = files.some((f) => /readme/i.test(f.path));
          const hasSrc = files.some((f) => /^(src|public|app|components)\//i.test(f.path));
          if (hasReadme && hasSrc) finish(tCode, "PASS", `README бар; құрылым ұйымдастырылған (${files.length} файл)`);
          else if (files.length > 0) finish(tCode, "PARTIAL", `README: ${hasReadme ? "бар" : "жоқ"}; құрылым: ${hasSrc ? "ұйымдастырылған" : "түйінді файлдар түбірде"}`);
          else finish(tCode, "FAIL", "Репозиторий бос");
        } else {
          finish(tRepo, "BLOCKED", `GitHub API жауабы: HTTP ${resp.status}`, { limitations: "API шектеуі немесе қате — талдау орындалмады." });
          finish(tCode, "BLOCKED", "GitHub API қолжетімсіз");
        }
      } catch (e) {
        finish(tRepo, "BLOCKED", `Желі қатесі: ${String(e).slice(0, 120)}`, { limitations: "Сыртқы желіге қосылу мүмкін болмады." });
        finish(tCode, "BLOCKED", "Желі қатесі");
      }
    }
  }
  ctx.res.tests.push(tRepo);
  ctx.res.tests.push(tCode);
}
