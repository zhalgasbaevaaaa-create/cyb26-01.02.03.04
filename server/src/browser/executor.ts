// Нақты браузерлік тестілеу қозғалтқышы (Playwright).
// Мұнда ешқандай нәтиже ойлап табылмайды: әр тест нақты әрекет пен бақылауға негізделеді.
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CONFIG } from "../config.js";
import { isRequestHostAllowed, validateUrl } from "@gha/shared/src/urlSecurity.js";
import type { EvaluationRecord, JobStage, Requirement, TestResult, TestStatus, ModuleSettings, TestModuleKey } from "@gha/shared";
import { DEFAULT_MODULE_SETTINGS } from "@gha/shared";
import { PROFILES, TASK_TYPE_KEYWORDS, LIVES_KEYWORDS, HUB_KEYWORDS, GOOGLE_LOGIN_KEYWORDS, extractSpecKeywords, type ProfileChecks } from "./profiles.js";
import { loadAnswerKey, compareAgainstKey } from "./answerKey.js";
import { AxeBuilder } from "@axe-core/playwright";

// Master prompt §4-дегі 15 кезеңді pipeline. 1–12 кезеңін осы executor жүргізеді;
// 13–15 («Requirements сәйкестігі», «Бағалау», «Қорытынды есеп») — runner.ts-та,
// браузер жабылғаннан кейін (ұпай есептеу/есеп шығару браузерді қажет етпейді).
export const STAGE_KEYS = [
  "validate",
  "load",
  "browser",
  "ui",
  "mechanics",
  "history",
  "levels",
  "auth",
  "backend",
  "gamehub",
  "security",
  "repo",
  "requirements",
  "scoring",
  "report",
] as const;

export const STAGE_LABELS: Record<string, string> = {
  validate: "1. URL қауіпсіздігін тексеру (SSRF сүзгісі)",
  load: "2. Сайтқа қосылу",
  browser: "3. Браузерлік тест (консоль, желі бақылауы)",
  ui: "4. Интерфейсті және навигацияны тексеру",
  mechanics: "5. Ойын механикасын тексеру",
  history: "6. 6 тарихи тапсырманы тексеру",
  levels: "7. 10 деңгей жүйесін тексеру",
  auth: "8. Google авторизациясын тексеру",
  backend: "9. Backend және деректердің сақталуын тексеру",
  gamehub: "10. GAME HUB порталы мен Leaderboard тексеру",
  security: "11. Security аудиті",
  repo: "12. Source-code аудиті (GitHub берілсе)",
  requirements: "13. Requirements сәйкестігі",
  scoring: "14. Бағалау",
  report: "15. Қорытынды есеп",
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
  networkLog: { url: string; method: string }[];
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
  moduleSettings: ModuleSettings = DEFAULT_MODULE_SETTINGS,
): Promise<ExecutorResult> {
  const assignment =
    ({
      A1: "action_arcade_survival",
      A2: "strategy_tower_defense",
      A3: "shooter_quiz",
      A4: "racing_quiz",
      A5: "match3_puzzle_rpg",
      A6: "adventure_escape",
      OTHER: "custom_generic",
    } as Record<string, string>)[assignmentId] ?? "custom_generic";
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
  const ctx: Ctx = { res, rec, profileKey: assignment, pageText: "", screenshotCount: 0, networkLog: [] };
  const baseProfile = PROFILES[assignment];
  // «Басқа ойын түрі» үшін: еркін техникалық тапсырма мәтінінен алынған ықтимал
  // кейіпкер/кезең/механика атауларын жалпы индикаторлар тізіміне қосамыз
  // (А1–А6-дағы бекітілген тізім болмағандықтан — бұл қосымша, бірақ дәлме-дәл емес дәлел көзі).
  const profile: ProfileChecks =
    assignment === "custom_generic" && rec.customSpecText
      ? (() => {
          const extra = extractSpecKeywords(rec.customSpecText!);
          if (extra.length === 0) return baseProfile;
          res.limitations.push(
            `«Басқа ойын түрі» режимі: техникалық тапсырма мәтінінен ${extra.length} ықтимал кілт сөз/тіркес алынды және кейіпкер/кезең/механика тексерулеріне қосымша дәлел ретінде қолданылды: ${extra.slice(0, 15).join(", ")}${extra.length > 15 ? "…" : ""}.`,
          );
          return {
            ...baseProfile,
            characters: [...baseProfile.characters, ...extra],
            levels: [...baseProfile.levels, ...extra],
            mechanics: [...baseProfile.mechanics, ...extra],
          };
        })()
      : baseProfile;
  const opts = { allowLocalhostForTests: CONFIG.allowLocalhostForTests };

  // Әкімші бұл тест модулін өшірген бе? Өшірілсе — тиісті талаптарға еш тест
  // жазылмайды, сондықтан олар автоматты түрде «Тексерілмеді» күйінде қалады
  // (ұпайға әсер етпейді, бірақ бағада да ЖОҚ деп саналмайды — honest NOT_VERIFIED).
  const isModuleEnabled = (key: TestModuleKey): boolean => moduleSettings.enabledModules[key] !== false;
  const skipModule = async (key: TestModuleKey, label: string): Promise<void> => {
    const t = newTest(`EVIDENCE-MODULE-${key.toUpperCase()}`, `${label} — модуль өшірілген`);
    finish(t, "NOT_VERIFIED", "Бұл тест модулі әкімші параметрлерінде (Жүйе параметрлері → Тест модульдері) өшірілген.", {
      limitations: "Модуль өшірілгендіктен, бұған қатысты барлық талаптар «Тексерілмеді» күйінде қалады және ұпайға әсер етпейді.",
    });
    ctx.res.tests.push(t);
    ctx.res.limitations.push(`«${label}» тест модулі әкімші параметрлерінде өшірілген — тиісті талаптар тексерілмеді.`);
    await onStage(key, "skipped");
  };

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    // ===== 1. VALIDATE =====
    await onStage("validate", "running");
    const check = await validateUrl(rec.projectUrl, opts);
    // ЕСКЕРТУ: бұл — аудитордың өз қорғаныс қақпасы (SSRF сүзгісі), студент жобасының
    // қауіпсіздік көрсеткіші ЕМЕС, сондықтан ешбір бағалау критерийіне есептелмейді
    // (requirementId "GATE-..." — REQUIREMENTS тізімінде жоқ, demek ұпайға әсер етпейді).
    const tVal = newTest("GATE-SSRF", "Сілтеменің жарамдылығы мен SSRF сүзгісі (аудитордың өз қорғанысы)");
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

    // ===== 3. БРАУЗЕРЛІК ТЕСТ: Браузерді іске қосу =====
    await onStage("browser", "running");
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: "GameHubAuditor/1.0 (университеттік автоматты тексеру)",
      locale: "kk-KZ",
    });
    context.setDefaultTimeout(moduleSettings.timeouts.pageActionTimeoutMs || CONFIG.pageActionTimeoutMs);

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
      ctx.networkLog.push({ url: route.request().url(), method: route.request().method() });
      await route.continue();
    });

    page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") res.consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on("pageerror", (err) => res.consoleErrors.push(String(err.message).slice(0, 300)));
    page.on("requestfailed", (req) => res.failedRequests.push(`${req.url().slice(0, 200)} (${req.failure()?.errorText ?? "белгісіз"})`));
    await onStage("browser", "done");
    if (rec.cancelRequested) return res;

    // ===== 2(жалғасы). LOAD: Сайтқа қосылу =====
    await onStage("load", "running");
    const tLoad = newTest("C-HUB-MAIN", "Сайттың қолжетімділігі мен жүктелуі");
    tLoad.browser = "Chromium (headless)";
    tLoad.viewport = "1366×768";
    tLoad.actions.push(`goto(${check.finalUrl})`);
    tLoad.expected = "Сайт ашылады, HTTP 2xx/3xx жауабы, мазмұн көрінеді";
    try {
      const resp = await page.goto(check.finalUrl!, { waitUntil: "domcontentloaded", timeout: moduleSettings.timeouts.navTimeoutMs || CONFIG.navTimeoutMs });
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
      // Сайт ашылмаса, браузерлік кезеңдер орындалмайды — бәрі BLOCKED.
      // Репозиторий талдауы (12-кезең) браузерді қажет етпейді — ол бәрібір орындалады.
      for (const key of ["ui", "mechanics", "history", "levels", "auth", "backend", "gamehub", "security"]) {
        const t = newTest("C-HUB-MAIN", `${STAGE_LABELS[key]} — сайт қолжетімсіз`);
        finish(t, "BLOCKED", "Сайт жүктелмеді — кезең орындалмады", { limitations: "Негізгі бет ашылмағандықтан тексеру мүмкін болмады." });
        res.tests.push(t);
        await onStage(key, "skipped");
      }
      if (isModuleEnabled("repo")) {
        await onStage("repo", "running");
        await checkRepo(ctx);
        await onStage("repo", "done");
      } else {
        await skipModule("repo", STAGE_LABELS.repo);
      }
      return res;
    }
    if (rec.cancelRequested) return res;

    // ===== 4. UI =====
    await onStage("ui", "running");
    const buttons = await page.locator("button:visible, [role='button']:visible, a.btn:visible").count();
    const links = await page.locator("a[href]:visible").count();
    const inputs = await page.locator("input:visible, textarea:visible, select:visible").count();
    // ЕСКЕРТУ: бұл жалпы интерфейс/навигация дәлелі — белгілі бір PDF талабына тікелей
    // сәйкес келмейді (requirementId "EVIDENCE-..." — REQUIREMENTS тізімінде жоқ,
    // сондықтан ешбір критерийге ұпай ретінде есептелмейді, тек дәлел ретінде сақталады).
    const tUi = newTest("EVIDENCE-UI-NAV", "Интерфейс элементтері мен навигация (жалпы дәлел)");
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
    // Адаптивтілік (responsive) және негізгі қолжетімділік (accessibility) тексерулері
    // де осы «Интерфейсті тексеру» кезеңіне жатады (15 кезеңнің тізімінде жеке баптары жоқ).
    // ЕСКЕРТУ: «ui» модулі өшірілсе — тек осы екі қосымша тексеру аталады; негізгі
    // навигация/мәтін жинау әрқашан орындалады, себебі келесі кезеңдер ctx.pageText-ке тәуелді.
    if (isModuleEnabled("ui")) {
      await checkResponsive(page, context, ctx);
      await checkAccessibility(page, ctx);
    } else {
      ctx.res.limitations.push(`«${STAGE_LABELS.ui}» модулінің қосымша тексерулері (адаптивтілік, accessibility) әкімші параметрлерінде өшірілген.`);
    }
    await onStage("ui", "done");
    if (rec.cancelRequested) return res;

    // ===== 5. GAME MECHANICS (профиль бойынша) =====
    if (isModuleEnabled("mechanics")) {
      await onStage("mechanics", "running");
      await checkCharacters(page, ctx, profile, assignmentId);
      await checkCoreMechanics(page, ctx, profile, assignmentId);
      await onStage("mechanics", "done");
    } else {
      await skipModule("mechanics", STAGE_LABELS.mechanics);
    }
    if (rec.cancelRequested) return res;

    // ===== 6. HISTORY TASKS =====
    if (isModuleEnabled("history")) {
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
    } else {
      await skipModule("history", STAGE_LABELS.history);
    }
    if (rec.cancelRequested) return res;

    // ===== 7. LEVELS/DIFFICULTY (10 деңгей жүйесі) =====
    if (isModuleEnabled("levels")) {
      await onStage("levels", "running");
      await checkLevels(page, ctx, profile, assignmentId);
      // «Басқа ойын түрі» үшін ғана: кезеңдер арасындағы логикалық байланыс пен
      // ойынның жалпы күрделілігі (А1–А6-ға бұл қосымша тексерулер жоқ — олардың
      // рубрикасы PDF-тен алынған нақты талаптармен шектеледі).
      if (assignment === "custom_generic") {
        await checkStageLogic(page, ctx);
        await checkComplexity(page, ctx);
      }
      await onStage("levels", "done");
    } else {
      await skipModule("levels", STAGE_LABELS.levels);
    }
    if (rec.cancelRequested) return res;

    // ===== 8. AUTH (Google OAuth ғана) =====
    if (isModuleEnabled("auth")) {
      await onStage("auth", "running");
      await checkGoogleAuth(page, ctx);
      await onStage("auth", "done");
    } else {
      await skipModule("auth", STAGE_LABELS.auth);
    }
    if (rec.cancelRequested) return res;

    // ===== 9. BACKEND / DATA PERSISTENCE =====
    if (isModuleEnabled("backend")) {
      await onStage("backend", "running");
      await checkBackendPersistence(page, ctx);
      await onStage("backend", "done");
    } else {
      await skipModule("backend", STAGE_LABELS.backend);
    }
    if (rec.cancelRequested) return res;

    // ===== 10. GAME HUB PORTAL & LEADERBOARD =====
    if (isModuleEnabled("gamehub")) {
      await onStage("gamehub", "running");
      await checkGameHub(page, ctx);
      // «Басқа ойын түрі» үшін ғана: ұпай беру жүйесі және ұпай есептеудің
      // қайталанушылығы (детерминизмі) — А1–А6 ойындарында бұл C-HUB-RATING
      // тестімен жабылады, бірақ ол кестенің болуын ғана тексереді.
      if (assignment === "custom_generic") {
        await checkScoreSystemGeneric(page, ctx);
      }
      await onStage("gamehub", "done");
    } else {
      await skipModule("gamehub", STAGE_LABELS.gamehub);
    }
    if (rec.cancelRequested) return res;

    // ===== 11. SECURITY AUDIT =====
    if (isModuleEnabled("security")) {
      await onStage("security", "running");
      await checkSecurity(page, ctx);
      await onStage("security", "done");
    } else {
      await skipModule("security", STAGE_LABELS.security);
    }
    // Консоль қателері мен сәтсіз желілік сұраныстар — code quality критерийіне жатады
    // (security модулінен тәуелсіз: беттің ашық кезінде ғана өлшенеді).
    const tConsole = newTest("C-CONSOLE", "JavaScript консоль қателері мен сәтсіз сұраныстар");
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
    if (rec.cancelRequested) return res;

    // ===== 12. SOURCE-CODE АУДИТІ (GitHub берілсе) =====
    if (isModuleEnabled("repo")) {
      await onStage("repo", "running");
      await checkRepo(ctx);
      await onStage("repo", "done");
    } else {
      await skipModule("repo", STAGE_LABELS.repo);
    }

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

  // Ойын алгоритмінің тұтастығы (C-ALGO) — сол интеракция дәлелдеріне негізделген,
  // бірақ бұл ЕШҚАШАН нақты код деңгейіндегі алгоритмді («game loop» формуласын,
  // қиындық формуласын) растамайды — тек сырттан байқалатын мінез-құлық.
  const tAlgo = newTest("C-ALGO", "Ойын алгоритмі мен күй ауысуының тұтастығы (game loop, прогрессия)");
  tAlgo.expected = "Байқалатын мінез-құлық (әрекет → күй өзгерісі) логикалық, қайталанатын және бұзылмаған";
  tAlgo.actions.push(`Алдыңғы интеракция дәлелі қайта пайдаланылды: ${interactionEvidence}`);
  if (interactionEvidence.includes("өзгерді") && found.length >= 2) {
    finish(tAlgo, "PARTIAL", "Сырттан байқалатын әрекет→күй ауысуы логикалық және қайталанатын, бірақ нақты алгоритм (game loop/қиындық формуласы) тек URL арқылы толық қалпына келтірілмейді", {
      limitations: "Толық алгоритм реконструкциясы тек код деректерінсіз мүмкін емес (repositoryUrl берілсе, статикалық талдау C-CODE/C-SEC-REPO тесттерінде жүргізіледі).",
    });
  } else {
    finish(tAlgo, "NOT_VERIFIED", "Әрекет→күй ауысуының жеткілікті дәлелі жиналмады — алгоритм тұтастығы тексерілмеді", {
      limitations: "Ойын механикасының сырттан байқалатын реакциясы болмағандықтан, алгоритм логикасы туралы қорытынды жасау мүмкін емес.",
    });
  }
  ctx.res.tests.push(tAlgo);
}

// ---------- «Басқа ойын түрі» (custom_generic) үшін қосымша тексерулер ----------
// Бұл үш функция тек assignmentId === "OTHER" болғанда шақырылады (жоғарыдағы
// `if (assignment === "custom_generic")` шарттары арқылы). А1–А6 тапсырмаларының
// мінез-құлқына ЕШҚАНДАЙ әсер етпейді.

/** OTHER-STAGE-LOGIC: кезеңдер арасындағы логикалық байланыс (бос black-box дәлел). */
async function checkStageLogic(page: Page, ctx: Ctx): Promise<void> {
  const t = newTest("OTHER-STAGE-LOGIC", "Кезеңдер арасындағы логикалық байланыс");
  t.expected = "Әртүрлі кезең/деңгей ашылғанда мазмұны нақты ерекшеленеді (бірдей экран қайталанбайды)";
  const levelEls = page
    .locator("[class*='level' i]:visible, [class*='kez' i]:visible, [data-level]:visible, a:visible, button:visible")
    .filter({ hasText: /деңгей|level|кезең|stage|бөлім|round|раунд/i });
  const count = await levelEls.count();
  t.actions.push(`Кезең/деңгей сілтейтін элементтер табылды: ${count}`);
  if (count < 2) {
    finish(t, "NOT_VERIFIED", "Кемінде екі бөлек кезең элементі табылмады — кезеңдер арасындағы байланысты автоматты тексеру мүмкін болмады", {
      limitations: "Бұл тексеру тек кемінде екі қолжетімді кезең/деңгей сілтемесі табылғанда жүргізіледі.",
    });
    ctx.res.tests.push(t);
    return;
  }
  try {
    const before = await safeInnerText(page);
    await levelEls.nth(0).click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    const first = await safeInnerText(page);
    await page.goBack({ timeout: 4000 }).catch(() => undefined);
    await page.waitForTimeout(400);
    const freshLevelEls = page
      .locator("[class*='level' i]:visible, [class*='kez' i]:visible, [data-level]:visible, a:visible, button:visible")
      .filter({ hasText: /деңгей|level|кезең|stage|бөлім|round|раунд/i });
    await freshLevelEls.nth(1).click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    const second = await safeInnerText(page);
    const shot = await takeScreenshot(page, ctx, "kezender-baylanys");
    const distinctFromHome = first !== before || second !== before;
    const distinctFromEachOther = first !== second;
    t.actions.push(
      `1-кезең ашылғаннан кейінгі мәтін ${first === before ? "басты беттен өзгермеді" : "өзгерді"}; 2-кезең ${second === first ? "1-кезеңмен бірдей" : "ерекшеленеді"}`,
    );
    if (distinctFromEachOther && distinctFromHome) {
      finish(t, "PASS", "Әртүрлі кезеңдер ашылғанда мазмұн нақты ерекшеленеді — логикалық байланыс белгісі бар", { screenshot: shot });
    } else if (distinctFromHome) {
      finish(t, "PARTIAL", "Кезеңдер ашылады, бірақ екі кезеңнің мазмұны бірдей болып көрінді", {
        screenshot: shot,
        limitations: "Кезеңдердің ішкі мазмұны нақты бөлек пе, әлде бір шаблон ма — анық емес.",
      });
    } else {
      finish(t, "FAIL", "Кезең элементтерін басқанда мазмұн өзгермеді", { screenshot: shot });
    }
  } catch (e) {
    finish(t, "NOT_VERIFIED", `Кезеңдерді салыстыру әрекеті сәтсіз аяқталды: ${String(e).slice(0, 150)}`);
  }
  ctx.res.tests.push(t);
}

/** OTHER-COMPLEXITY: ойынның күрделілігі — тек объективті өлшенетін прокси-сигналдар. */
async function checkComplexity(page: Page, ctx: Ctx): Promise<void> {
  const t = newTest("OTHER-COMPLEXITY", "Ойынның күрделілігі (өлшенетін прокси-көрсеткіштер)");
  t.expected = "Бірнеше өзара тәуелді ішкі жүйе байқалады (кейіпкер + кезең + механика + тапсырма түрлері + графика)";
  const has = (id: string) => ctx.res.tests.some((x) => x.requirementId === id && (x.status === "PASS" || x.status === "PARTIAL"));
  const taskTypesFound = ctx.res.tests.filter((x) => /^C-TASK-\d/.test(x.requirementId) && (x.status === "PASS" || x.status === "PARTIAL")).length;
  const canvasCount = await page.locator("canvas:visible").count();
  const signals = {
    characters: has("OTHER-CHARS") ? 1 : 0,
    levels: has("OTHER-LEVELS") ? 1 : 0,
    mechanics: has("OTHER-MECH") ? 1 : 0,
    taskTypes: taskTypesFound >= 2 ? 1 : 0,
    canvas: canvasCount > 0 ? 1 : 0,
  };
  const signalCount = Object.values(signals).reduce((a, b) => a + b, 0);
  t.actions.push(
    `Сигналдар: кейіпкер=${signals.characters}, кезең=${signals.levels}, механика=${signals.mechanics}, тапсырма түрлері(≥2 табылды: ${taskTypesFound})=${signals.taskTypes}, canvas(${canvasCount})=${signals.canvas} → жиыны ${signalCount}/5`,
  );
  if (signalCount >= 4) {
    finish(t, "PASS", `${signalCount}/5 күрделілік сигналы табылды — ойын бірнеше өзара әрекеттесетін ішкі жүйеден тұрады`, {
      limitations: "Бұл тек объективті өлшенетін прокси-көрсеткіш, толық сараптамалық бағалау емес.",
    });
  } else if (signalCount >= 2) {
    finish(t, "PARTIAL", `${signalCount}/5 күрделілік сигналы ғана табылды`, {
      limitations: "Қалған сигналдар табылмады немесе тексерілмеді.",
    });
  } else {
    finish(t, "NOT_VERIFIED", `Тек ${signalCount}/5 сигнал табылды — күрделілік туралы сенімді қорытынды жасауға жеткіліксіз дәлел`, {
      limitations: "Жеткіліксіз дәлел «қарапайым» дегенді білдірмейді — тек автоматты түрде анықталмады.",
    });
  }
  ctx.res.tests.push(t);
}

const SCORE_REGEX = /(ұпай|score|points?|нәтиже)[^\d\n]{0,12}(-?\d[\d\s]{0,7})/i;

function extractScoreValue(text: string): number | null {
  const m = text.match(SCORE_REGEX);
  if (!m) return null;
  const n = Number(m[2].replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** OTHER-SCORE-SYSTEM + OTHER-SCORE-ACCURACY: ұпай беру жүйесі және оның қайталанушылығы. */
async function checkScoreSystemGeneric(page: Page, ctx: Ctx): Promise<void> {
  const tSys = newTest("OTHER-SCORE-SYSTEM", "Ұпай беру жүйесінің болуы");
  tSys.expected = "Бетте ұпай/нәтиже элементі бар және ойыншы әрекетінен кейін мәні өзгереді";
  const before = await safeInnerText(page);
  const beforeScore = extractScoreValue(before);
  tSys.actions.push(`Әрекет алдындағы ұпай мәні: ${beforeScore ?? "табылмады"}`);
  const actionEl = page.locator("button:visible, [role='button']:visible, canvas:visible, a:visible").first();
  let clicked = false;
  try {
    if (await actionEl.count()) {
      await actionEl.click({ timeout: 3000 });
      clicked = true;
      await page.waitForTimeout(700);
    }
  } catch { /* клик сәтсіз болса — төменде NOT_VERIFIED/FAIL-мен есепке алынады */ }
  const after = await safeInnerText(page);
  const afterScore = extractScoreValue(after);
  tSys.actions.push(`Әрекет (${clicked ? "клик жасалды" : "клик мүмкін болмады"}) кейінгі ұпай мәні: ${afterScore ?? "табылмады"}`);
  const shot = await takeScreenshot(page, ctx, "upai-zhuyesi");
  const delta1 = beforeScore !== null && afterScore !== null ? afterScore - beforeScore : null;

  if (beforeScore === null && afterScore === null) {
    finish(tSys, "NOT_VERIFIED", "Бетте ұпай/нәтиже көрсеткіші табылмады", {
      screenshot: shot,
      limitations: "Ұпай элементі басқа бетте/модальда болуы мүмкін — тек басты бетте ізделді.",
    });
    ctx.res.tests.push(tSys);
    const tAcc = newTest("OTHER-SCORE-ACCURACY", "Ұпай есептеудің дәлдігі/тұрақтылығы");
    finish(tAcc, "NOT_VERIFIED", "Ұпай элементі табылмағандықтан, есептеудің қайталанушылығын тексеру мүмкін болмады");
    ctx.res.tests.push(tAcc);
    return;
  }
  if (delta1 !== null && delta1 !== 0) {
    finish(tSys, "PASS", `Әрекеттен кейін ұпай ${beforeScore} → ${afterScore} (Δ${delta1 > 0 ? "+" : ""}${delta1}) өзгерді`, { screenshot: shot });
  } else if (afterScore !== null) {
    finish(tSys, "PARTIAL", `Ұпай көрсеткіші бар (${afterScore}), бірақ бір клик әрекетінен кейін өзгеріс байқалмады`, {
      screenshot: shot,
      limitations: "Ұпай белгілі бір дұрыс жауаптан кейін ғана өзгеруі мүмкін — жалпы клик жеткіліксіз болуы ықтимал.",
    });
  } else {
    finish(tSys, "NOT_VERIFIED", "Ұпай мәні анықталды, бірақ әрекеттен кейінгі мәнді оқу мүмкін болмады", { screenshot: shot });
  }
  ctx.res.tests.push(tSys);

  // Қайталанушылық/детерминизм: бетті қайта жүктеп, сол бірінші әрекетті қайталау
  const tAcc = newTest("OTHER-SCORE-ACCURACY", "Ұпай есептеудің дәлдігі/тұрақтылығы");
  tAcc.expected = "Бірдей әрекетті жаңа сессияда қайталағанда ұпай өзгерісі бірдей болады";
  if (delta1 === null || delta1 === 0) {
    finish(tAcc, "NOT_VERIFIED", "Алғашқы әрекетте нақты ұпай өзгерісі тіркелмегендіктен, қайталанушылықты тексеру мүмкін болмады", {
      limitations: "Бұл тест тек бірінші әрекеттен нақты, нөлдік емес ұпай өзгерісі тіркелгенде жүргізіледі.",
    });
    ctx.res.tests.push(tAcc);
    return;
  }
  try {
    await page.reload({ timeout: 15000, waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.waitForTimeout(800);
    const before2 = await safeInnerText(page);
    const beforeScore2 = extractScoreValue(before2);
    const actionEl2 = page.locator("button:visible, [role='button']:visible, canvas:visible, a:visible").first();
    if (await actionEl2.count()) await actionEl2.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(700);
    const after2 = await safeInnerText(page);
    const afterScore2 = extractScoreValue(after2);
    const delta2 = beforeScore2 !== null && afterScore2 !== null ? afterScore2 - beforeScore2 : null;
    tAcc.actions.push(`1-сынақ Δ=${delta1}; 2-сынақ (бетті қайта жүктегеннен кейін) Δ=${delta2 ?? "анықталмады"}`);
    const shot2 = await takeScreenshot(page, ctx, "upai-tuyraqtylyk");
    if (delta2 !== null && delta2 === delta1) {
      finish(tAcc, "PASS", `Екі сынақта да ұпай өзгерісі бірдей болды (Δ${delta1}) — есептеу тұрақты/детерминистік болып көрінеді`, { screenshot: shot2 });
    } else if (delta2 !== null) {
      finish(tAcc, "FAIL", `Ұпай өзгерісі сынақтар арасында сәйкес келмеді: 1-сынақ Δ${delta1}, 2-сынақ Δ${delta2}`, { screenshot: shot2 });
    } else {
      finish(tAcc, "NOT_VERIFIED", "Екінші сынақта ұпай мәнін қайта оқу мүмкін болмады", { screenshot: shot2 });
    }
  } catch (e) {
    finish(tAcc, "NOT_VERIFIED", `Қайталау сынағы сәтсіз аяқталды: ${String(e).slice(0, 150)}`);
  }
  ctx.res.tests.push(tAcc);
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
}

async function checkGameHub(page: Page, ctx: Ctx): Promise<void> {
  const text = await safeInnerText(page);
  const shot = await takeScreenshot(page, ctx, "gamehub-portal");

  // GAME HUB порталының бөлімдері
  const tHubPages = newTest("C-HUB-PAGES", "GAME HUB порталының 6 бөлімі");
  const hubFound = containsAny(text, HUB_KEYWORDS);
  tHubPages.actions.push(`Портал бөлімдері ізделді; табылды (${hubFound.length}/6): ${hubFound.join(", ") || "ештеңе"}`);
  tHubPages.expected = "Ойындар тізімі, рейтинг, профиль, нәтижелер, әкімші, рейтинг жүйесі бөлімдері бар";
  if (hubFound.length >= 5) finish(tHubPages, "PASS", `${hubFound.length}/6 бөлім табылды: ${hubFound.join(", ")}`, { screenshot: shot });
  else if (hubFound.length >= 2) finish(tHubPages, "PARTIAL", `Тек ${hubFound.length}/6 бөлім табылды: ${hubFound.join(", ")}`, { screenshot: shot });
  else finish(tHubPages, "FAIL", "GAME HUB бөлімдері табылмады", { screenshot: shot });
  ctx.res.tests.push(tHubPages);

  // Рейтинг кестесі (нақты деректермен — қатаң қолдан жазылмаған)
  const tRating = newTest("C-HUB-RATING", "Рейтинг кестесі (Орын/Студент/Ойын/Ұпай/Деңгей), нақты деректермен");
  tRating.expected = "Кемінде 5 бағаны бар рейтинг кестесі көрінеді, деректер қатаң жазылмаған (hardcoded емес)";
  const tables = await page.locator("table:visible").count();
  const ratingKeywords = containsAny(text, ["орын", "рейтинг", "ұпай", "деңгей"]);
  tRating.actions.push(`Кестелер: ${tables}; рейтинг кілт сөздері: ${ratingKeywords.join(", ") || "жоқ"}`);
  const shotR = await takeScreenshot(page, ctx, "reiting");
  // Деректердің hardcoded еместігін жеке AJAX/fetch сұранысымен толық дәлелдеу мүмкін емес
  // (бұл үшін екі түрлі сессиядан деректер салыстырылуы керек) — сондықтан PASS емес, тек PARTIAL.
  if (tables > 0 && ratingKeywords.length >= 2) {
    finish(tRating, "PARTIAL", "Кесте және рейтинг белгілері бар; бағандардың толықтығы мен деректердің нақты (hardcoded емес) екені толық дәлелденбеді", {
      screenshot: shotR,
      limitations: "Кестенің көрінуі нәтижелердің шынымен backend-тен келетінін толық дәлелдемейді — бұл үшін екі түрлі нәтижемен қайта тексеру қажет.",
    });
  } else if (ratingKeywords.length >= 3) {
    finish(tRating, "PARTIAL", "Рейтинг мәтіні бар, бірақ кесте табылмады", { screenshot: shotR });
  } else {
    finish(tRating, "FAIL", "Рейтинг кестесі табылмады", { screenshot: shotR });
  }
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
  const tHttps = newTest("C-SEC-HTTPS", "HTTPS қолданылуы");
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
    finish(tSecrets, "FAIL", `Құпия кілт анықталды — мәні әдейі жасырылды. (${findings.join("; ")})`);
    ctx.res.securityWarnings.push(`Клиенттік кодта құпия кілт іздері: ${findings.join("; ")}. Кілттерді сервер жағына көшіріңіз.`);
  }
  ctx.res.tests.push(tSecrets);

  // SSRF-бұғатталған сұраныстар туралы ескерту
  if (ctx.res.blockedRequests.length > 0) {
    ctx.res.securityWarnings.push(`Бет ${ctx.res.blockedRequests.length} сұранысты ішкі/тыйым салынған мекенжайға жіберуге тырысты (бұғатталды).`);
  }

  // Input validation / XSS сынағы (қауіпсіз, бұзбайтын зонд)
  const tXss = newTest("C-SEC-XSS", "Енгізу өрістерінің қауіпсіздігі (XSS сынағы)");
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

  // ===== C-SEC-INPUT: бос/шектен тыс ұзын/күтпеген таңбалы енгізулер =====
  const tInput = newTest("C-SEC-INPUT", "Енгізу валидациясы (бос, шектен тыс ұзын, күтпеген таңбалар)");
  tInput.expected = "Бос, тым ұзын және күтпеген таңбалары бар енгізулер серверде/клиентте дұрыс өңделеді (қирау жоқ)";
  const probeInputs = page.locator("input[type='text']:visible, input:not([type]):visible, textarea:visible");
  const probeCount = Math.min(await probeInputs.count(), 1);
  if (probeCount > 0) {
    const scenarios = ["", "a".repeat(5000), "±!@#$%^&*()_+{}[]|\\<>?~`№\"';漢字😀"];
    const errorsBefore = ctx.res.consoleErrors.length;
    let crashed = false;
    let probed = 0;
    for (const scenario of scenarios) {
      try {
        const input = probeInputs.first();
        await input.fill(scenario, { timeout: 2000 });
        await page.keyboard.press("Enter").catch(() => undefined);
        await page.waitForTimeout(250);
        probed++;
      } catch {
        crashed = true;
      }
    }
    const stillResponsive = await page.evaluate(() => document.readyState).catch(() => "unknown");
    const newErrors = ctx.res.consoleErrors.length - errorsBefore;
    tInput.actions.push(`Сценарийлер сыналды: бос, 5000 таңба, арнайы/эмодзи таңбалар (${probed}/${scenarios.length}); беттің күйі: ${stillResponsive}; жаңа консоль қателері: ${newErrors}`);
    if (crashed || stillResponsive !== "complete") {
      finish(tInput, "FAIL", "Енгізу сценарийінен кейін бет қирады немесе жауап бермейді", { limitations: "Тек қауіпсіз, бұзбайтын сынақтар қолданылды." });
    } else if (newErrors > 0) {
      finish(tInput, "PARTIAL", `Бет жұмыс істеуін жалғастырды, бірақ ${newErrors} жаңа консоль қатесі пайда болды`, { limitations: "Тек қауіпсіз, бұзбайтын сынақтар қолданылды." });
    } else {
      finish(tInput, "PASS", "Бос, өте ұзын және арнайы таңбалы енгізулер бетті қиратпады", {});
    }
  } else {
    finish(tInput, "NOT_VERIFIED", "Мәтін енгізу өрістері табылмады", { limitations: "Енгізу валидациясын автоматты сынау мүмкін болмады." });
  }
  ctx.res.tests.push(tInput);

  // ===== C-SEC-SESSION: рұқсатсыз қатынасты болдырмау (бақыланатын белгілер) =====
  const tSession = newTest("C-SEC-SESSION", "Сессия басқаруы: кіру күйі, шығу, рұқсатсыз қатынасты болдырмау");
  tSession.expected = "Аутентификацияланбаған қолданушы қорғалған беттерге кіре алмайды; сессия күйі байқалады";
  const candidatePaths = ["/admin", "/profile", "/dashboard", "/account"];
  const base = ctx.res.finalUrl ?? "";
  let adminExposed = false;
  let pathsChecked = 0;
  if (base) {
    try {
      const origin = new URL(base).origin;
      for (const p of candidatePaths) {
        try {
          const resp = await page.goto(origin + p, { waitUntil: "domcontentloaded", timeout: 4000 });
          pathsChecked++;
          if (resp && resp.status() >= 200 && resp.status() < 300) {
            const t2 = (await safeInnerText(page)).toLowerCase();
            if (/әкімші|admin panel|administrator|барлық пайдаланушы/i.test(t2)) {
              adminExposed = true;
              tSession.actions.push(`${p}: HTTP ${resp.status()}, әкімші тәрізді мазмұн аутентификациясыз көрінді`);
            } else {
              tSession.actions.push(`${p}: HTTP ${resp.status()}, қорғалған мазмұн белгісі табылмады`);
            }
          } else {
            tSession.actions.push(`${p}: HTTP ${resp?.status() ?? "жауап жоқ"}`);
          }
        } catch {
          tSession.actions.push(`${p}: қолжетімсіз/қате`);
        }
      }
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 6000 }).catch(() => undefined);
    } catch { /* базалық URL талдау қатесі */ }
  }
  if (pathsChecked === 0) {
    finish(tSession, "NOT_VERIFIED", "Сессия/авторизация шекарасын тексеру мүмкін болмады", {
      limitations: "Нақты аккаунт/сессиямен толық кіру-шығу ағынын сынау тесттік аккаунтсыз мүмкін емес.",
    });
  } else if (adminExposed) {
    finish(tSession, "FAIL", "Ықтимал қорғалған бет (admin/dashboard) аутентификациясыз ашық көрінді", {
      limitations: "Бұл тек беттің жүктелуін білдіреді — нақты деректерге қол жеткізу толық расталмады.",
    });
  } else {
    finish(tSession, "PARTIAL", `${pathsChecked} ықтимал қорғалған жол тексерілді, анық бұзылу белгісі табылмады`, {
      limitations: "Нақты Google аккаунтымен толық кіру/шығу/сессия мерзімінің аяқталу сынағы жасалмады.",
    });
  }
  ctx.res.tests.push(tSession);

  // ===== C-SEC-RATE: негізгі rate limiting =====
  const tRate = newTest("C-SEC-RATE", "Негізгі rate limiting (сұраныс санын шектеу)");
  tRate.expected = "Қысқа уақытта көп қайталанған сұраныс кезінде сервер шектеу/қате қайтарады (HTTP 429 немесе эквивалент)";
  const apiLike = ctx.networkLog.find((n) => /\/api\/|\.json(\?|$)|firebaseio|supabase/i.test(n.url) && !/\.(png|jpg|jpeg|svg|css|woff2?)(\?|$)/i.test(n.url));
  if (apiLike) {
    try {
      const statuses: number[] = await page.evaluate(async (url) => {
        const results: number[] = [];
        for (let i = 0; i < 6; i++) {
          try {
            const r = await fetch(url, { method: "GET" });
            results.push(r.status);
          } catch {
            results.push(0);
          }
        }
        return results;
      }, apiLike.url);
      tRate.actions.push(`6 қайталанған сұраныс жіберілді (${apiLike.url.slice(0, 80)}): статустар ${statuses.join(", ")}`);
      if (statuses.includes(429)) {
        finish(tRate, "PASS", "Сервер шектеуге жеткенде HTTP 429 қайтарды");
      } else if (statuses.every((s) => s >= 200 && s < 300)) {
        finish(tRate, "PARTIAL", "6 жылдам қайталанған сұраныстың барлығы сәтті өтті — анық шектеу байқалмады", {
          limitations: "Тек 6 сұраныс жіберілді (DoS сынағы емес) — нақты лимит табалдырығы одан жоғары болуы мүмкін.",
        });
      } else {
        finish(tRate, "NOT_VERIFIED", `Сұраныстар әртүрлі статуспен аяқталды (${statuses.join(", ")}) — лимиттің нәтижесі екіұшты`);
      }
    } catch (e) {
      finish(tRate, "NOT_VERIFIED", `Сұраныс жіберу мүмкін болмады: ${String(e).slice(0, 120)}`);
    }
  } else {
    finish(tRate, "NOT_VERIFIED", "Backend API соңғы нүктесі байқалмады — rate limiting сынауға негіз жоқ", {
      limitations: "Тек байқалған желілік сұраныстар негізінде тексеру жасалады; API шақыруы тіркелмесе, сынау мүмкін емес.",
    });
  }
  ctx.res.tests.push(tRate);

  // ===== C-SEC-ANTICHEAT: рейтинг манипуляциясынан қорғау белгілері =====
  const tAnticheat = newTest("C-SEC-ANTICHEAT", "Рейтинг манипуляциясынан қорғау (ұпайдың тек клиентте сақталмауы)");
  tAnticheat.expected = "Ұпай/деңгей тек localStorage/клиент жадында емес, серверлік сұраныстар арқылы расталады";
  let localStorageInfo = "";
  try {
    localStorageInfo = await page.evaluate(() => Object.keys(localStorage).join(", "));
  } catch { /* қолжетімсіз */ }
  const scoreInLocalStorage = /score|ұпай|points|level|деңгей/i.test(localStorageInfo);
  const hasBackendTraffic = ctx.networkLog.some((n) => /firebaseio|supabase|\/api\/|googleapis\.com\/.*firestore/i.test(n.url));
  tAnticheat.actions.push(`localStorage кілттері: ${localStorageInfo || "жоқ"}; backend-ке ұқсас желілік сұраныс: ${hasBackendTraffic ? "бар" : "жоқ"}`);
  if (scoreInLocalStorage) ctx.res.securityWarnings.push("Ұпай/деңгей localStorage-де сақталады — клиент жағынан өзгертуге осал болуы мүмкін (leaderboard manipulation тәуекелі). Серверлік тексеру қажет.");
  if (scoreInLocalStorage && !hasBackendTraffic) {
    finish(tAnticheat, "FAIL", "Ұпай/деңгей тек localStorage-де табылды, серверлік сұраныс байқалмады — манипуляция тәуекелі жоғары");
  } else if (scoreInLocalStorage && hasBackendTraffic) {
    finish(tAnticheat, "PARTIAL", "Ұпай localStorage-де де, серверлік сұраныстар да бар — серверлік тексерудің толықтығы автоматты расталмады", {
      limitations: "Серверлік валидацияның іс жүзінде орындалатынын (мысалы, клиенттен келген ұпайды сервер қайта есептейтінін) тексеру үшін backend кодын немесе API жауабын талдау қажет.",
    });
  } else if (hasBackendTraffic) {
    finish(tAnticheat, "PARTIAL", "Серверлік сұраныстар байқалды, localStorage-де ұпай белгісі жоқ — жақсы белгі, бірақ толық сервер жағындағы валидация расталмады");
  } else {
    finish(tAnticheat, "NOT_VERIFIED", "Ұпай сақтау тәсілінің байқалатын дәлелі жиналмады");
  }
  ctx.res.tests.push(tAnticheat);
}

async function checkAccessibility(page: Page, ctx: Ctx): Promise<void> {
  const t = newTest("C-A11Y", "Негізгі автоматты қолжетімділік (accessibility) тексеруі");
  t.expected = "Батырмаларда қолжетімді атаулар, өрістерде белгілер, логикалық тақырып құрылымы бар; критикалық accessibility қателері жоқ";
  try {
    const results = await new AxeBuilder({ page }).analyze();
    const critical = results.violations.filter((v) => v.impact === "critical");
    const serious = results.violations.filter((v) => v.impact === "serious");
    const other = results.violations.length - critical.length - serious.length;
    t.actions.push(
      `axe-core сканері орындалды: барлығы ${results.violations.length} бұзушылық (critical: ${critical.length}, serious: ${serious.length}, басқа: ${other})`,
    );
    const examples = results.violations.slice(0, 3).map((v) => `${v.id} (${v.impact ?? "?"}, ${v.nodes.length} элемент)`);
    if (examples.length) t.actions.push(`Мысалдар: ${examples.join("; ")}`);
    if (critical.length === 0 && serious.length === 0) {
      finish(t, "PASS", `Критикалық/маңызды accessibility бұзушылығы табылмады (жалпы: ${results.violations.length})`);
    } else if (critical.length === 0) {
      finish(t, "PARTIAL", `${serious.length} маңызды accessibility бұзушылығы табылды: ${examples.join("; ")}`, {
        limitations: "Тек автоматты түрде анықталатын мәселелер тексерілді — толық қолмен accessibility аудиті емес.",
      });
    } else {
      finish(t, "FAIL", `${critical.length} критикалық accessibility бұзушылығы табылды: ${examples.join("; ")}`, {
        limitations: "Тек автоматты түрде анықталатын мәселелер тексерілді — толық қолмен accessibility аудиті емес.",
      });
    }
  } catch (e) {
    finish(t, "NOT_VERIFIED", `axe-core сканерін орындау мүмкін болмады: ${String(e).slice(0, 150)}`);
  }
  ctx.res.tests.push(t);
}

async function checkBackendPersistence(page: Page, ctx: Ctx): Promise<void> {
  // ===== C-BACKEND: нақты backend қолданылуының байқалатын дәлелі =====
  const tBackend = newTest("C-BACKEND", "Backend/дерекқор қолданылуының байқалатын дәлелі (Firebase/Supabase/API)");
  tBackend.expected = "Желілік сұраныстар немесе бет коды нақты backend (Firebase/Supabase/меншікті API) қолданылатынын көрсетеді";
  const backendHosts = ctx.networkLog
    .map((n) => { try { return new URL(n.url).hostname; } catch { return ""; } })
    .filter((h) => /firebaseio\.com|firebaseapp\.com|googleapis\.com|supabase\.co|herokuapp\.com|vercel\.app|onrender\.com|railway\.app/i.test(h));
  const uniqueHosts = Array.from(new Set(backendHosts));
  let html = "";
  try { html = await page.content(); } catch { /* бет жабылған */ }
  const sdkMentioned = /firebase|supabase|firestore|realtime database/i.test(html);
  tBackend.actions.push(`Backend-ке ұқсас хосттар: ${uniqueHosts.join(", ") || "жоқ"}; кодта SDK белгісі: ${sdkMentioned ? "бар" : "жоқ"}`);
  if (uniqueHosts.length > 0) {
    finish(tBackend, "PASS", `Нақты backend трафигі байқалды: ${uniqueHosts.join(", ")}`, {
      limitations: "URL-only режимде тек байқалатын мінез-құлық тексеріледі; backend-тің нақты қауіпсіздігі/архитектурасы расталмайды.",
    });
  } else if (sdkMentioned) {
    finish(tBackend, "PARTIAL", "Кодта backend SDK белгісі бар, бірақ нақты желілік сұраныс байқалмады", {
      limitations: "SDK қосылуы міндетті түрде белсенді backend қолданысын білдірмейді.",
    });
  } else {
    finish(tBackend, "NOT_VERIFIED", "Backend қолданысының байқалатын дәлелі табылмады", {
      limitations: "Бұл backend жоқ дегенді білдірмейді — желілік сұраныстар бұғатталған немесе кешіктірілген болуы мүмкін.",
    });
  }
  ctx.res.tests.push(tBackend);

  // ===== C-PERSIST: нәтиженің сақталуы (қайта жүктегенде) =====
  const tPersist = newTest("C-PERSIST", "Нәтиженің сақталуы (бетті қайта жүктегенде/жаңа сессияда)");
  tPersist.expected = "Беттің мазмұны/күйі тек жадта емес, қайта жүктегеннен кейін де байқалатын деңгейде сақталады";
  let lsBefore = "";
  try { lsBefore = await page.evaluate(() => JSON.stringify(localStorage)); } catch { /* қолжетімсіз */ }
  const textBefore = await safeInnerText(page);
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForTimeout(800);
    let lsAfter = "";
    try { lsAfter = await page.evaluate(() => JSON.stringify(localStorage)); } catch { /* қолжетімсіз */ }
    const textAfter = await safeInnerText(page);
    const lsPersisted = lsBefore.length > 2 && lsBefore === lsAfter;
    const textSimilar = textAfter.length > 0 && Math.abs(textAfter.length - textBefore.length) < Math.max(50, textBefore.length * 0.3);
    tPersist.actions.push(`Бет қайта жүктелді; localStorage сақталды: ${lsPersisted ? "иә" : "жоқ/бос"}; мәтін ұзындығы сәйкес: ${textSimilar ? "иә" : "жоқ"}`);
    if (lsPersisted) {
      finish(tPersist, "PARTIAL", "localStorage деректері қайта жүктегеннен кейін де сақталды (клиенттік сақтау дәлелі)", {
        limitations: "Бұл тек клиенттік (localStorage) сақтауды дәлелдейді — серверлік/дерекқорлық сақтауды (басқа құрылғыда/аккаунтта көрінуін) толық растамайды.",
      });
    } else if (textSimilar) {
      finish(tPersist, "NOT_VERIFIED", "Бет қайта жүктелді, бірақ сақталатын деректің нақты дәлелі табылмады", {
        limitations: "Аутентификациясыз толық профиль сақталуын тексеру мүмкін емес.",
      });
    } else {
      finish(tPersist, "NOT_VERIFIED", "Қайта жүктеу алдындағы/кейінгі күйді сенімді салыстыру мүмкін болмады");
    }
  } catch (e) {
    finish(tPersist, "NOT_VERIFIED", `Бетті қайта жүктеу мүмкін болмады: ${String(e).slice(0, 120)}`);
  }
  ctx.res.tests.push(tPersist);
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
            finish(tRepo, "FAIL", `Құпия кілт анықталды — мәні әдейі жасырылды. (${[...secretLabels].join("; ")})`);
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
