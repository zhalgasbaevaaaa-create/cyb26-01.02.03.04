// Fixture-дің 10 бақыланатын сценарийін (A–J) нақты executor арқылы тексеру.
// Мақсат: аудитордың детерминистикалық түрде дұрыс PASS/PARTIAL/FAIL/NOT_VERIFIED
// күйлерін қоятынын дәлелдеу — PDF-тің «10 fixture сценарийімен өзін-өзі тексеру»
// талабы. Әр сценарий fixtures/test-site/index.html ішіндегі ?variant= параметрі
// арқылы нақты бір мүмкіндікті бұзады/толықтырады, ал қалғанының бәрі әдепкі
// (pipeline.test.ts негіздейтін) мінез-құлықпен бірдей қалады.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gha-variants-"));
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
  criteria: { key: string; earnedPoints: number; maxPoints: number }[];
  totalScore: number;
};

async function waitForAudit(id: string, timeoutMs = 60_000): Promise<AuditRec> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const resp = await fetch(`${base}/api/audits/${id}`, { headers: auth });
    const rec = (await resp.json()) as AuditRec;
    if (!["queued", "running"].includes(String(rec.status))) return rec;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Тексеру уақыт шегінен асты");
}

async function runVariant(variant: string, studentSuffix: string): Promise<AuditRec> {
  const r = await fetch(`${base}/api/audits`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      studentName: `Fixture Variant ${studentSuffix}`,
      groupName: "CYB26-SELFTEST",
      projectUrl: variant ? `${base}/fixture/?variant=${variant}` : `${base}/fixture/`,
      assignmentId: "A1",
      instructorNotes: "Автоматты өзін-өзі тексеру сценарийі, нақты студент жобасы емес.",
    }),
  });
  expect(r.status, `variant=${variant} audit сұранысы 202 қайтаруы керек`).toBe(202);
  const { id } = (await r.json()) as { id: string };
  const rec = await waitForAudit(id);
  expect(rec.status, `variant=${variant} аудиті аяқталуы керек`).toBe("completed");
  return rec;
}

function byReq(rec: AuditRec, reqId: string): TestRow[] {
  return rec.tests.filter((t) => t.requirementId === reqId);
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

describe("fixture self-test: variant A/J — толық жұмыс істейтін жоба", () => {
  it("6/6 тапсырма түрі, backend белгісі бар, бұзылған батырма жоқ → жоғары балл", async () => {
    const rec = await runVariant("A", "A");
    expect(byReq(rec, "C-TASK-4")[0]?.status, "карта тапсырмасы енді PARTIAL/PASS болуы керек").not.toBe("FAIL");
    expect(byReq(rec, "C-TASK-5")[0]?.status, "сурет тапсырмасы енді PARTIAL/PASS болуы керек").not.toBe("FAIL");
    expect(byReq(rec, "C-BACKEND")[0]?.status, "backend SDK белгісі табылды → PARTIAL").toBe("PARTIAL");
    expect(byReq(rec, "C-SEC-CLIENT")[0]?.status, "құпия кілт жоқ → PASS").toBe("PASS");
    // Ескерту: fixture-де favicon.ico жоқтығынан туындайтын 404 консоль хабарламалары
    // БАРЛЫҚ нұсқада (A/J қоса) кездеседі — бұл C-CONSOLE-ді FAIL/PARTIAL етуі мүмкін,
    // бірақ бұл «әдейі» қате емес. Сондықтан тек ӘДЕЙІ eнгізілген қатенің ЖОҚ екенін тексереміз.
    const consoleTest = byReq(rec, "C-CONSOLE")[0];
    expect(consoleTest?.actual, "әдейі енгізілген fixture қатесі A/J-де болмауы керек").not.toContain("Сынақ үшін әдейі консоль қатесі");
  }, 60_000);

  it("J нұсқасы да дәл A сияқты нәтиже береді (детерминистік)", async () => {
    const rec = await runVariant("J", "J");
    expect(byReq(rec, "C-TASK-4")[0]?.status).not.toBe("FAIL");
    expect(byReq(rec, "C-TASK-5")[0]?.status).not.toBe("FAIL");
    expect(byReq(rec, "C-BACKEND")[0]?.status).toBe("PARTIAL");
  }, 60_000);
});

describe("fixture self-test: variant B — Google кіру мүлде жоқ", () => {
  it("C-GOOGLE FAIL болады", async () => {
    const rec = await runVariant("B", "B");
    expect(byReq(rec, "C-GOOGLE")[0]?.status, "Google батырмасы жоқ → FAIL").toBe("FAIL");
  }, 60_000);
});

describe("fixture self-test: variant C — тек 3/6 тапсырма түрі", () => {
  it("C-TASK-6 енді PASS/PARTIAL емес (тапсырма алынып тасталды), бірақ критерийлер нөлге түспейді", async () => {
    const rec = await runVariant("C", "C");
    // Тапсырма⑥ бөлімі толық алынып тасталды, тек «жылы құрылды» деген кездейсоқ
    // ұқсас тіркес q1 сұрағында қалады (бір ғана кілтсөз) → NOT_VERIFIED,
    // бірақ ешқашан PASS/PARTIAL (толық форматтың дәлелі) болмауы керек.
    expect(["FAIL", "NOT_VERIFIED"]).toContain(byReq(rec, "C-TASK-6")[0]?.status);
    for (const c of rec.criteria) expect(c.earnedPoints).toBeGreaterThanOrEqual(0);
  }, 60_000);
});

describe("fixture self-test: variant D — тек 2/10 деңгей", () => {
  it("A1-LEVELS енді PASS емес", async () => {
    const rec = await runVariant("D", "D");
    expect(byReq(rec, "A1-LEVELS")[0]?.status, "көп кезең жоғалды → PASS болмауы керек").not.toBe("PASS");
  }, 60_000);
});

describe("fixture self-test: variant E/F — backend жоқ / рейтинг қатаң жазылған (no-op)", () => {
  it("E: C-BACKEND әдепкімен бірдей (NOT_VERIFIED)", async () => {
    const rec = await runVariant("E", "E");
    expect(byReq(rec, "C-BACKEND")[0]?.status).toBe("NOT_VERIFIED");
  }, 60_000);

  it("F: C-HUB-RATING ешқашан PASS бермейді (hardcoded дәлелі әрқашан PARTIAL/FAIL)", async () => {
    const rec = await runVariant("F", "F");
    expect(byReq(rec, "C-HUB-RATING")[0]?.status).not.toBe("PASS");
  }, 60_000);
});

describe("fixture self-test: variant G — ашық қалған құпия кілт", () => {
  it("C-SEC-CLIENT FAIL болады және ескерту тіркеледі", async () => {
    const rec = await runVariant("G", "G");
    const sec = byReq(rec, "C-SEC-CLIENT")[0];
    expect(sec?.status, "AWS үлгідегі кілт табылды → FAIL").toBe("FAIL");
    expect(sec?.actual).toContain("AWS");
  }, 60_000);
});

describe("fixture self-test: variant H — бірнеше бұзылған батырма", () => {
  it("A1-MECH және C-LIVES енді PASS емес (батырмалар тыңдаушысыз)", async () => {
    const rec = await runVariant("H", "H");
    expect(byReq(rec, "A1-MECH")[0]?.status, "start-btn тыңдаушысыз → PASS болмауы керек").not.toBe("PASS");
    expect(byReq(rec, "C-LIVES")[0]?.status, "lose-btn тыңдаушысыз → толық ағын дәлелденбейді").not.toBe("PASS");
  }, 60_000);
});

describe("fixture self-test: variant I — мобильді схемада көлденең тасқын", () => {
  it("C-RESP FAIL болады (3 өлшемде де тасқын бар)", async () => {
    const rec = await runVariant("I", "I");
    expect(byReq(rec, "C-RESP")[0]?.status, "min-width:1600px барлық өлшемде тасқын тудырады → FAIL").toBe("FAIL");
  }, 60_000);
});

describe("fixture self-test: вариант параметрі жоқ — әдепкі (регрессия сақшысы)", () => {
  it("variant параметрісіз мінез-құлық pipeline.test.ts-тегімен бірдей қалады", async () => {
    const rec = await runVariant("", "default");
    expect(byReq(rec, "C-TASK-4")[0]?.status).not.toBe("PASS");
    expect(byReq(rec, "C-GOOGLE").some((t) => t.status === "PARTIAL")).toBe(true);
    expect(byReq(rec, "C-SEC-CLIENT")[0]?.status).toBe("PASS");
    expect(byReq(rec, "A1-MECH").some((t) => t.status === "PASS")).toBe(true);
  }, 60_000);
});
