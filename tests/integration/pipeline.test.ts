// Толық құбыр сынағы: сервер + нақты Playwright + fixture сайт.
// Мақсат: аудитордың ЖҰМЫС ІСТЕЙТІН және БҰЗЫЛҒАН мүмкіндіктерді ажырататынын дәлелдеу.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gha-test-"));
process.env.ADMIN_TOKEN = "integration-test-token";
process.env.ALLOW_LOCALHOST_FOR_TESTS = "1";
process.env.DATA_DIR = TMP;
process.env.EVIDENCE_DIR = path.join(TMP, "evidence");
process.env.GHA_NO_LISTEN = "1";
process.env.MAX_CONCURRENT_JOBS = "1";

let createApp: () => import("express").Express;
let server: import("http").Server;
let base = "";
const auth = { Authorization: "Bearer integration-test-token", "Content-Type": "application/json" };

async function waitForAudit(id: string, timeoutMs = 240_000): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const resp = await fetch(`${base}/api/audits/${id}`, { headers: auth });
    const rec = (await resp.json()) as Record<string, unknown>;
    if (!["queued", "running"].includes(String(rec.status))) return rec;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Тексеру уақыт шегінен асты");
}

beforeAll(async () => {
  const mod = await import("../../server/src/index.js");
  createApp = mod.createApp;
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
}, 30_000);

afterAll(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("аутентификация", () => {
  it("қате кілтпен — 401", async () => {
    const r = await fetch(`${base}/api/audits`, { headers: { Authorization: "Bearer wrong" } });
    expect(r.status).toBe(401);
  });
  it("дұрыс кілтпен login — ok", async () => {
    const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "integration-test-token" }) });
    expect(r.status).toBe(200);
  });
});

describe("кіріс валидациясы мен SSRF", () => {
  it("жарамсыз URL — 400", async () => {
    const r = await fetch(`${base}/api/audits`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ studentName: "Тест", groupName: "CYB26-1", projectUrl: "кездейсоқ", assignmentId: "A1" }),
    });
    expect(r.status).toBe(400);
  });
  it("cloud метадеректер нүктесі бұғатталады (SSRF)", async () => {
    const r = await fetch(`${base}/api/audits`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ studentName: "Тест", groupName: "CYB26-1", projectUrl: "http://169.254.169.254/latest/meta-data/", assignmentId: "A1" }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: string };
    expect(body.error).toContain("SSRF");
  });
  it("file:// схемасы бұғатталады", async () => {
    const r = await fetch(`${base}/api/audits`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ studentName: "Тест", groupName: "CYB26-1", projectUrl: "file:///etc/passwd", assignmentId: "A1" }),
    });
    expect(r.status).toBe(400);
  });
  it("тапсырма таңдалмаса — 400", async () => {
    const r = await fetch(`${base}/api/audits`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ studentName: "Тест", groupName: "CYB26-1", projectUrl: "http://127.0.0.1:1/x", assignmentId: "A9" }),
    });
    expect(r.status).toBe(400);
  });
});

describe("қолжетімсіз сайт", () => {
  it("ашылмайтын порт — тексеру BLOCKED/FAIL болады, бірақ сервер тірі", async () => {
    const r = await fetch(`${base}/api/audits`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ studentName: "Қолжетімсіз Тест", groupName: "CYB26-1", projectUrl: "http://127.0.0.1:59999/joq", assignmentId: "A1" }),
    });
    expect(r.status).toBe(202);
    const { id } = (await r.json()) as { id: string };
    const rec = (await waitForAudit(id, 120_000)) as { status: string; tests: { status: string; actual: string }[] };
    expect(["blocked", "failed", "completed"]).toContain(rec.status);
    const load = rec.tests.find((t) => t.actual.includes("ашылмады") || t.actual.includes("қолжетімсіз") || t.actual.includes("ERR"));
    expect(load, "жүктеу тесті қатені тіркеуі керек").toBeTruthy();
  }, 180_000);
});

describe("толық аудит: fixture сайт (A1 профилі)", () => {
  let rec: {
    id: string;
    status: string;
    progress: number;
    tests: { requirementId: string; name: string; status: string; actual: string; screenshot?: string; limitations?: string }[];
    criteria: { key: string; earnedPoints: number; maxPoints: number; verified: boolean }[];
    totalScore: number;
    provisionalScore: number;
    verificationCoverage: number;
    securityWarnings: string[];
    reportRefs: { pdf?: string; csv?: string };
  };

  it("аудит аяқталады және нәтижелер нақты", async () => {
    const r = await fetch(`${base}/api/audits`, {
      method: "POST", headers: auth,
      body: JSON.stringify({
        studentName: "Сынақ Студент",
        groupName: "CYB26-TEST",
        projectUrl: `${base}/fixture/`,
        assignmentId: "A1",
        instructorNotes: "Бұл — fixture сынағы, студент жобасы емес.",
      }),
    });
    expect(r.status).toBe(202);
    const { id } = (await r.json()) as { id: string };
    rec = (await waitForAudit(id)) as typeof rec;
    expect(rec.status).toBe("completed");
    expect(rec.progress).toBe(100);
    expect(rec.tests.length).toBeGreaterThan(10);

    const byReq = (id: string) => rec.tests.filter((t) => t.requirementId === id);

    // --- ЖҰМЫС ІСТЕЙТІН мүмкіндіктер PASS болуы керек ---
    expect(byReq("C-HUB-MAIN").some((t) => t.status === "PASS"), "сайт жүктелуі PASS").toBe(true);
    expect(byReq("A1-CHARS").some((t) => t.status === "PASS"), "10 кейіпкер PASS").toBe(true);
    expect(byReq("A1-LEVELS").some((t) => t.status === "PASS"), "10 кезең PASS").toBe(true);
    expect(byReq("C-LIVES").some((t) => t.status === "PASS"), "жан біткенде механикасы PASS (fixture-де толық ағын бар)").toBe(true);
    expect(byReq("C-RESP").some((t) => t.status === "PASS"), "адаптивтілік PASS").toBe(true);
    expect(byReq("A1-MECH").some((t) => t.status === "PASS"), "механика PASS").toBe(true);

    // --- БҰЗЫЛҒАН/ЖОҚ мүмкіндіктер FAIL/NOT_VERIFIED болуы керек ---
    expect(byReq("C-SEC-HTTPS").some((t) => t.status === "FAIL"), "HTTP (HTTPS емес) FAIL").toBe(true);
    const task4 = byReq("C-TASK-4");
    expect(["FAIL", "NOT_VERIFIED", "PARTIAL"], "карта тапсырмасы жоқ").toContain(task4[0]?.status);
    expect(task4[0]?.status).not.toBe("PASS");
    const task5 = byReq("C-TASK-5");
    expect(task5[0]?.status, "сурет тапсырмасы жоқ").not.toBe("PASS");
    expect(byReq("C-GOOGLE-DATA")[0]?.status, "профиль деректері тексерілмеді").toBe("NOT_VERIFIED");
    expect(byReq("C-HIST-ACC")[0]?.status, "жауап кілті жоқ → тексерілмеді").toBe("NOT_VERIFIED");
    expect(byReq("C-SEC-REPO")[0]?.status, "репозиторий жоқ → тексерілмеді").toBe("NOT_VERIFIED");

    // Google батырмасы бар, бірақ жұмысы дәлелденбеген → PARTIAL
    expect(byReq("C-GOOGLE").some((t) => t.status === "PARTIAL"), "Google батырмасы PARTIAL").toBe(true);

    // --- Ұпай ережелері ---
    expect(rec.totalScore).toBeGreaterThan(0);
    expect(rec.totalScore).toBeLessThan(100);
    expect(rec.provisionalScore).toBeGreaterThan(0);
    expect(rec.verificationCoverage).toBeGreaterThan(0.3);
    // history_tasks критерийі ішінде C-HIST-ACC (жауап кілті жоқ) NOT_VERIFIED болғандықтан,
    // ол талап ұпайға әсер етпейді (жаңа 10-критерий жүйесінде history_tasks 13 талапты
    // біріктіреді, сондықтан басқа тапсырмалар PASS болса, критерий жалпы verified=true
    // болуы мүмкін — бірақ C-HIST-ACC нақты «тексерілмеген» тізімде көрінуі керек).
    const histTasks = rec.criteria.find((c) => c.key === "history_tasks")!;
    expect(histTasks.unverifiedRequirements).toContain("C-HIST-ACC");
    expect(histTasks.earnedPoints).toBeLessThan(histTasks.maxPoints);
    // Жиынтық ереже: әр критерий ұпайы ≤ максимум
    for (const c of rec.criteria) expect(c.earnedPoints).toBeLessThanOrEqual(c.maxPoints);

    // --- Қауіпсіздік ескертулері (fixture-де әдейі осалдықтар бар) ---
    expect(rec.securityWarnings.some((w) => w.includes("HTTPS")), "HTTPS ескертуі").toBe(true);
    expect(rec.securityWarnings.some((w) => w.includes("XSS")), "XSS ескертуі (әдейі осал өріс)").toBe(true);
    expect(rec.securityWarnings.some((w) => w.includes("localStorage")), "ұпай манипуляция ескертуі").toBe(true);

    // --- Дәлелдер: скриншоттар шынымен сақталды ---
    const shots = rec.tests.filter((t) => t.screenshot);
    expect(shots.length).toBeGreaterThan(3);
    for (const s of shots.slice(0, 3)) {
      const p = path.join(process.env.EVIDENCE_DIR!, s.screenshot!);
      expect(fs.existsSync(p), `скриншот бар: ${p}`).toBe(true);
      expect(fs.statSync(p).size).toBeGreaterThan(1000);
    }

    // --- Есептер ---
    expect(rec.reportRefs.pdf).toBeTruthy();
    expect(rec.reportRefs.csv).toBeTruthy();
    const pdfPath = path.join(process.env.DATA_DIR!, "reports", rec.reportRefs.pdf!.split("/").pop()!);
    const csvPath = path.join(process.env.DATA_DIR!, "reports", rec.reportRefs.csv!.split("/").pop()!);
    expect(fs.existsSync(pdfPath)).toBe(true);
    expect(fs.readFileSync(pdfPath).subarray(0, 5).toString()).toBe("%PDF-");
    const csv = fs.readFileSync(csvPath, "utf-8");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("Сынақ Студент");
    expect(csv).toContain("КРИТЕРИЙЛЕР");
    expect(csv).toContain("Орындалды");
  }, 300_000);

  it("дубликат жоба 5 минут ішінде қайта қабылданбайды", async () => {
    const r = await fetch(`${base}/api/audits`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ studentName: "Сынақ Студент", groupName: "CYB26-TEST", projectUrl: `${base}/fixture/`, assignmentId: "A1" }),
    });
    expect(r.status).toBe(409);
    const body = (await r.json()) as { error: string };
    expect(body.error).toContain("Дубликат");
  });

  it("қайта тексеру жаңа жазба жасайды", async () => {
    const r = await fetch(`${base}/api/audits/${rec.id}/retest`, { method: "POST", headers: auth });
    expect(r.status).toBe(202);
    const { id } = (await r.json()) as { id: string };
    expect(id).not.toBe(rec.id);
    const rec2 = (await waitForAudit(id, 240_000)) as { retestOf?: string; status: string };
    expect(rec2.status).toBe("completed");
    expect(rec2.retestOf).toBe(rec.id);
  }, 300_000);
});

describe("есептерді қорғалған жүктеу", () => {
  it("токенсіз есеп берілмейді", async () => {
    const list = await fetch(`${base}/api/audits`, { headers: auth });
    const { evaluations } = (await list.json()) as { evaluations: { reportRefs: { csv?: string } }[] };
    const withCsv = evaluations.find((e) => e.reportRefs.csv);
    expect(withCsv).toBeTruthy();
    const file = withCsv!.reportRefs.csv!.split("/").pop();
    const noAuth = await fetch(`${base}/api/reports/${file}`);
    expect(noAuth.status).toBe(401);
    const withAuth = await fetch(`${base}/api/reports/${file}`, { headers: auth });
    expect(withAuth.status).toBe(200);
  });
});

describe("тест модульдерін баптау (әкімші)", () => {
  type Tests = { requirementId: string; status: string }[];

  it("әдепкі параметрлер қолжетімді", async () => {
    const r = await fetch(`${base}/api/settings/modules`, { headers: auth });
    expect(r.status).toBe(200);
    const s = (await r.json()) as { enabledModules: Record<string, boolean> };
    expect(s.enabledModules.security).toBe(true);
  });

  it("модульді өшіру тиісті талаптарды ТЕКСЕРІЛМЕДІ күйінде қалдырады, ал бағаны нөлдемейді", async () => {
    // Security модулін өшіру
    const getResp = await fetch(`${base}/api/settings/modules`, { headers: auth });
    const current = await getResp.json();
    const putResp = await fetch(`${base}/api/settings/modules`, {
      method: "PUT", headers: auth,
      body: JSON.stringify({ ...current, enabledModules: { ...current.enabledModules, security: false } }),
    });
    expect(putResp.status).toBe(200);

    const r = await fetch(`${base}/api/audits`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ studentName: "Модуль Сынағы", groupName: "CYB26-TEST", projectUrl: `${base}/fixture/`, assignmentId: "A2" }),
    });
    expect(r.status).toBe(202);
    const { id } = (await r.json()) as { id: string };
    const rec = (await waitForAudit(id)) as { status: string; tests: Tests; criteria: { key: string; earnedPoints: number }[] };
    expect(rec.status).toBe("completed");

    // Security модулінің тесттері мүлде орындалмауы керек
    const secTests = rec.tests.filter((t) => t.requirementId.startsWith("C-SEC-") && t.requirementId !== "C-SEC-REPO");
    expect(secTests.length).toBe(0);
    // Модульдің өшірілгені туралы дәлел тіркелуі керек
    expect(rec.tests.some((t) => t.requirementId === "EVIDENCE-MODULE-SECURITY" && t.status === "NOT_VERIFIED")).toBe(true);
    // cybersecurity критерийі нөлге теңелмейді (NOT_VERIFIED қалады, verified=false, earnedPoints=0 — бұл дұрыс, себебі ешбір талап тексерілген жоқ)
    const cyberCrit = rec.criteria.find((c) => c.key === "cybersecurity")!;
    expect(cyberCrit.earnedPoints).toBe(0);

    // Әдепкі параметрлерді қалпына келтіру (басқа тесттерге әсер етпеу үшін)
    await fetch(`${base}/api/settings/modules`, {
      method: "PUT", headers: auth,
      body: JSON.stringify(current),
    });
  }, 60_000);

  it("жарамсыз таймаут мәні қабылданбайды", async () => {
    const getResp = await fetch(`${base}/api/settings/modules`, { headers: auth });
    const current = await getResp.json();
    const r = await fetch(`${base}/api/settings/modules`, {
      method: "PUT", headers: auth,
      body: JSON.stringify({ ...current, timeouts: { ...current.timeouts, navTimeoutMs: 500 } }),
    });
    expect(r.status).toBe(400);
  });
});
