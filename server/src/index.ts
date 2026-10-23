// GAME HUB PROJECT AUDITOR — сервер (Express + Playwright + JSON/Firestore дерекқор)
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { CONFIG, firebaseConfigured, googleOAuthConfigured } from "./config.js";
import { createAudit, cancelAudit, retest, queueLength } from "./jobs/runner.js";
import { listEvaluations, getEvaluation, deleteEvaluation, getActiveRubric, saveRubric, listRubrics, getModuleSettings, saveModuleSettings } from "./db/store.js";
import { ASSIGNMENTS, REQUIREMENTS, validateRubric, kz, DEFAULT_MODULE_SETTINGS, validateModuleSettings, DEFAULT_GRADING_BANDS } from "@gha/shared";
import { validateUrl } from "@gha/shared/src/urlSecurity.js";
import type { RubricVersion, ModuleSettings } from "@gha/shared";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "256kb" }));

  // ===== Аутентификация (Bearer токен; <img> үшін evidence-те ?token= рұқсат) =====
  const requireAuth = (allowQueryToken = false) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const header = req.headers.authorization ?? "";
    let token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token && allowQueryToken) token = String(req.query.token ?? "");
    if (!token || token !== CONFIG.adminToken) {
      res.status(401).json({ error: "Рұқсат жоқ: әкімші кілті қате немесе берілмеген." });
      return;
    }
    next();
  };

  // ===== Жүйе күйі (кіру беті үшін — ашық, құпиясыз) =====
  app.get("/api/system/info", (_req, res) => {
    res.json({
      version: "1.0.0",
      playwrightReady: true, // браузер орнатылған (Docker/startup тексеріледі)
      fixtureEnabled: CONFIG.allowLocalhostForTests,
      firebaseConfigured: firebaseConfigured(),
      googleOAuthConfigured: googleOAuthConfigured(),
      database: firebaseConfigured() ? "Firebase Firestore" : "JSON файл (локалды)",
    });
  });

  app.post("/api/auth/login", (req, res) => {
    const token = (req.body?.token ?? "").toString();
    if (token && token === CONFIG.adminToken) {
      res.json({ ok: true, message: "Жүйеге сәтті кірдіңіз." });
    } else {
      res.status(401).json({ ok: false, error: kz.common.loginError });
    }
  });

  // ===== Тапсырмалар мен талаптар матрицасы =====
  app.get("/api/assignments", requireAuth(), (_req, res) => {
    res.json({ assignments: ASSIGNMENTS, requirements: REQUIREMENTS });
  });

  // ===== Тексерулер =====
  const auditSchema = z.object({
    studentName: z.string().trim().min(2, "Студенттің аты-жөні кемінде 2 таңба болуы керек"),
    groupName: z.string().trim().min(2, "Оқу тобы кемінде 2 таңба болуы керек"),
    projectUrl: z.string().trim().min(8, "Жоба сілтемесі тым қысқа"),
    repositoryUrl: z.string().trim().optional().or(z.literal("")),
    assignmentId: z.enum(["A1", "A2", "A3", "A4", "A5", "A6"], { message: "Техникалық тапсырманы таңдаңыз (A1–A6)" }),
    instructorNotes: z.string().trim().max(2000).optional().or(z.literal("")),
  });

  app.post("/api/audits", requireAuth(), async (req, res) => {
    const parsed = auditSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: kz.common.validationFailed, details: parsed.error.issues.map((i) => i.message) });
      return;
    }
    const d = parsed.data;
    // SSRF сүзгісі — кезекке қоюдың алдында
    const urlCheck = await validateUrl(d.projectUrl, { allowLocalhostForTests: CONFIG.allowLocalhostForTests });
    if (!urlCheck.ok) {
      res.status(400).json({ error: urlCheck.reason ?? "Сілтеме қабылданбады." });
      return;
    }
    if (d.repositoryUrl) {
      const repoCheck = await validateUrl(d.repositoryUrl, { allowLocalhostForTests: false });
      if (!repoCheck.ok) {
        res.status(400).json({ error: `Репозиторий сілтемесі жарамсыз: ${repoCheck.reason}` });
        return;
      }
    }
    const result = await createAudit({ ...d, projectUrl: urlCheck.finalUrl ?? d.projectUrl });
    if (!result.ok) {
      res.status(409).json({ error: result.error });
      return;
    }
    res.status(202).json({ ok: true, id: result.record.id, message: "Тексеру кезекке қойылды." });
  });

  app.get("/api/audits", requireAuth(), async (_req, res) => {
    res.json({ evaluations: await listEvaluations(), queueLength: queueLength() });
  });

  app.get("/api/audits/:id", requireAuth(), async (req, res) => {
    const rec = await getEvaluation(req.params.id);
    if (!rec) { res.status(404).json({ error: "Жазба табылмады." }); return; }
    res.json(rec);
  });

  app.delete("/api/audits/:id", requireAuth(), async (req, res) => {
    const ok = await deleteEvaluation(req.params.id);
    if (!ok) { res.status(404).json({ error: "Жазба табылмады." }); return; }
    res.json({ ok: true });
  });

  app.post("/api/audits/:id/cancel", requireAuth(), async (req, res) => {
    const ok = await cancelAudit(req.params.id);
    if (!ok) { res.status(400).json({ error: "Бұл тексеруді болдырмау мүмкін емес (аяқталған немесе табылмады)." }); return; }
    res.json({ ok: true, message: "Тексеру болдырылмады." });
  });

  app.post("/api/audits/:id/retest", requireAuth(), async (req, res) => {
    const result = await retest(req.params.id);
    if (!result.ok) { res.status(400).json({ error: result.error }); return; }
    res.status(202).json({ ok: true, id: result.record.id, message: "Қайта тексеру кезекке қойылды." });
  });

  // ===== Рубрика =====
  app.get("/api/rubric", requireAuth(), async (_req, res) => {
    res.json({ active: await getActiveRubric(), all: await listRubrics() });
  });

  app.put("/api/rubric", requireAuth(), async (req, res) => {
    const body = req.body as Partial<RubricVersion>;
    if (!body?.criteria || !Array.isArray(body.criteria)) {
      res.status(400).json({ error: "Критерийлер тізімі берілмеді." });
      return;
    }
    const rubric: RubricVersion = {
      version: `v${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      criteria: body.criteria,
      passThreshold: Number(body.passThreshold ?? 60),
      provisionalThreshold: Number(body.provisionalThreshold ?? 0.7),
      gradingBands: Array.isArray(body.gradingBands) && body.gradingBands.length > 0
        ? body.gradingBands.map((b) => ({ min: Number(b.min), label: String(b.label) }))
        : DEFAULT_GRADING_BANDS,
    };
    const validation = validateRubric(rubric);
    if (!validation.valid) {
      res.status(400).json({ error: "Рубрика жарамсыз.", details: validation.errors });
      return;
    }
    await saveRubric(rubric);
    res.json({ ok: true, rubric, message: `Сақталған нұсқа: ${rubric.version}` });
  });

  // ===== Тест модульдері мен таймауттар (әкімші баптайды) =====
  app.get("/api/settings/modules", requireAuth(), async (_req, res) => {
    res.json(await getModuleSettings());
  });

  app.put("/api/settings/modules", requireAuth(), async (req, res) => {
    const body = req.body as Partial<ModuleSettings>;
    const settings: ModuleSettings = {
      enabledModules: { ...DEFAULT_MODULE_SETTINGS.enabledModules, ...(body.enabledModules ?? {}) },
      timeouts: { ...DEFAULT_MODULE_SETTINGS.timeouts, ...(body.timeouts ?? {}) },
      updatedAt: new Date().toISOString(),
    };
    const validation = validateModuleSettings(settings);
    if (!validation.valid) {
      res.status(400).json({ error: "Параметрлер жарамсыз.", details: validation.errors });
      return;
    }
    await saveModuleSettings(settings);
    res.json({ ok: true, settings, message: "Тест модульдері мен таймауттар сақталды." });
  });

  // ===== Есептер мен дәлелдер (авторизациямен қорғалған) =====
  app.get("/api/reports/:file", requireAuth(true), (req, res) => {
    const file = path.basename(req.params.file);
    const p = path.join(CONFIG.dataDir, "reports", file);
    if (!fs.existsSync(p)) { res.status(404).json({ error: "Есеп табылмады." }); return; }
    if (file.endsWith(".pdf")) res.type("application/pdf");
    if (file.endsWith(".csv")) res.type("text/csv; charset=utf-8");
    res.sendFile(p);
  });

  app.get("/api/evidence/:evalId/:file", requireAuth(true), (req, res) => {
    const evalId = path.basename(req.params.evalId);
    const file = path.basename(req.params.file);
    const p = path.join(CONFIG.evidenceDir, evalId, file);
    if (!fs.existsSync(p)) { res.status(404).json({ error: "Дәлел файлы табылмады." }); return; }
    res.type("image/png").sendFile(p);
  });

  // ===== Сынақ fixture сайты (тек ALLOW_LOCALHOST_FOR_TESTS=1 кезінде) =====
  if (CONFIG.allowLocalhostForTests) {
    app.use("/fixture", express.static(CONFIG.fixtureDir, { index: "index.html" }));
  }

  // ===== Клиент (өндірістік құрастыру) =====
  if (fs.existsSync(CONFIG.clientDist)) {
    app.use(express.static(CONFIG.clientDist));
    app.get(/^(?!\/api|\/fixture).*/, (_req, res) => {
      res.sendFile(path.join(CONFIG.clientDist, "index.html"));
    });
  }

  return app;
}

// Серверді іске қосу (тікелей іске қосылғанда)
if (process.env.VITEST !== "true" && !process.env.GHA_NO_LISTEN) {
  const app = createApp();
  app.listen(CONFIG.port, "0.0.0.0", () => {
    console.log(`[server] GAME HUB PROJECT AUDITOR: http://0.0.0.0:${CONFIG.port}`);
    console.log(`[server] Fixture режимі: ${CONFIG.allowLocalhostForTests ? "қосылған (тек сынақ!)" : "өшірілген"}`);
  });
}
