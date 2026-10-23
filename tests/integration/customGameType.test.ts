// «Басқа ойын түрі» (assignmentId = "OTHER") режимінің толық құбыр сынағы.
// Мақсат: А1–А6 бекітілген тапсырмаларына жатпайтын, еркін техникалық тапсырма
// мәтінімен сипатталған кез келген сайт-ойынды әмбебап тексеру тізімі бойынша
// (қауіпсіздік, Google кіру, ойын логикасы, ұпай жүйесі, кезеңдер, кезеңдер
// арасындағы логикалық байланыс, кейіпкерлер, күрделілік, тапсырмалар) бағалай
// алатынын дәлелдеу — pipeline.test.ts/fixtureVariants.test.ts-тегі А1-профилінің
// мінез-құлқына ЕШҚАНДАЙ әсер етпейтінін де растайды.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gha-other-"));
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

type TestRow = { requirementId: string; status: string; actual: string };
type AuditRec = {
  id: string;
  status: string;
  tests: TestRow[];
  criteria: { key: string; earnedPoints: number; maxPoints: number; verified: boolean }[];
  totalScore: number;
  limitations: string[];
};

async function waitForAudit(id: string, timeoutMs = 90_000): Promise<AuditRec> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const resp = await fetch(`${base}/api/audits/${id}`, { headers: auth });
    const rec = (await resp.json()) as AuditRec;
    if (!["queued", "running"].includes(String(rec.status))) return rec;
    await new Promise((r) => setTimeout(r, 1500));
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
  await new Promise((r) => server.close(() => r(undefined)));
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("«Басқа ойын түрі» (OTHER): валидация", () => {
  it("техникалық тапсырма мәтінсіз қабылданбайды", async () => {
    const r = await fetch(`${base}/api/audits`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        studentName: "Сынақ студент",
        groupName: "CYB26-OTHER",
        projectUrl: `${base}/fixture/`,
        assignmentId: "OTHER",
      }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { details?: string[] };
    expect(body.details?.some((d) => d.includes("техникалық тапсырма"))).toBe(true);
  });
});

describe("«Басқа ойын түрі» (OTHER): толық аудит", () => {
  let rec: AuditRec;

  it("техникалық тапсырма мәтінімен аудит аяқталады", async () => {
    const r = await fetch(`${base}/api/audits`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        studentName: "Generic Game Student",
        groupName: "CYB26-OTHER",
        projectUrl: `${base}/fixture/`,
        assignmentId: "OTHER",
        customSpecText:
          "Ойын «Томирис» атты кейіпкерге негізделген, 10 кезеңнен тұрады, әр кезеңде тарихи сұрақтар бар, ұпай жүйесі бар.",
        instructorNotes: "Генерик режимді тексеретін автоматты интеграциялық сынақ.",
      }),
    });
    expect(r.status).toBe(202);
    const { id } = (await r.json()) as { id: string };
    rec = await waitForAudit(id);
    expect(rec.status).toBe("completed");
  }, 120_000);

  it("жалпы (generic) тексерулердің барлығы жұмыс істеді (OTHER-* talap-id)", () => {
    const ids = rec.tests.map((t) => t.requirementId);
    for (const reqId of [
      "OTHER-CHARS",
      "OTHER-LEVELS",
      "OTHER-MECH",
      "OTHER-STAGE-LOGIC",
      "OTHER-COMPLEXITY",
      "OTHER-SCORE-SYSTEM",
      "OTHER-SCORE-ACCURACY",
    ]) {
      expect(ids, reqId).toContain(reqId);
    }
  });

  it("техникалық тапсырма мәтінінен алынған кілт сөз («Томирис») қолданылғаны тіркелді", () => {
    expect(rec.limitations.some((l) => l.includes("Томирис"))).toBe(true);
  });

  it("А1–А6-ға тән нақты (10 кейіпкер/10 деңгей) талаптар OTHER режимінде жоқ", () => {
    const ids = new Set(rec.tests.map((t) => t.requirementId));
    expect(ids.has("A1-CHARS")).toBe(false);
    expect(ids.has("A1-LEVELS")).toBe(false);
    expect(ids.has("A1-MEDIC")).toBe(false);
  });

  it("қауіпсіздік пен Google кіру тексерулері OTHER режимінде де жұмыс істейді (жанрға тәуелсіз)", () => {
    const ids = new Set(rec.tests.map((t) => t.requirementId));
    expect(ids.has("C-GOOGLE")).toBe(true);
    expect([...ids].some((id) => id.startsWith("C-SEC-"))).toBe(true);
    expect(ids.has("C-CONSOLE")).toBe(true);
  });

  it("gameplay/gamehub критерийлері расталды және ұпай 0-ден артық", () => {
    const gp = rec.criteria.find((c) => c.key === "gameplay")!;
    expect(gp.verified).toBe(true);
    expect(rec.totalScore).toBeGreaterThan(0);
  });
});
