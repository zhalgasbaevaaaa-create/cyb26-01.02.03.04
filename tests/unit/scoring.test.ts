// Бағалау қозғалтқышының детерминистік тестілері
import { describe, it, expect } from "vitest";
import { scoreEvaluation, requirementStatus, scoringStatement, round2 } from "../../shared/src/scoring";
import { DEFAULT_RUBRIC, criteriaSum, validateRubric } from "../../shared/src/rubric";
import { requirementsForAssignment } from "../../shared/src/requirements";
import type { TestResult } from "../../shared/src/types";

function t(requirementId: string, status: TestResult["status"], screenshot?: string): TestResult {
  return {
    id: `${requirementId}-${status}`,
    requirementId,
    name: "тест",
    startedAt: "2025-01-01T00:00:00Z",
    finishedAt: "2025-01-01T00:00:01Z",
    actions: [],
    expected: "",
    actual: "",
    status,
    screenshot,
  };
}

describe("талап күйін агрегаттау", () => {
  it("FAIL басым болады", () => {
    expect(requirementStatus("R", [t("R", "PASS"), t("R", "FAIL")])).toBe("FAIL");
  });
  it("PARTIAL PASS-тан басым", () => {
    expect(requirementStatus("R", [t("R", "PASS"), t("R", "PARTIAL")])).toBe("PARTIAL");
  });
  it("тек BLOCKED болса — BLOCKED", () => {
    expect(requirementStatus("R", [t("R", "BLOCKED")])).toBe("BLOCKED");
  });
  it("тест жоқ — NOT_VERIFIED", () => {
    expect(requirementStatus("R", [])).toBe("NOT_VERIFIED");
  });
});

describe("детерминистік ұпай", () => {
  const reqs = requirementsForAssignment("A1");

  it("барлық талап PASS — толық 100 (history_accuracy-дан басқа: ол answer_key)", () => {
    const tests = reqs
      .filter((r) => r.testMethod !== "answer_key" && r.testMethod !== "manual")
      .map((r) => t(r.id, "PASS", "shot.png"));
    const out = scoreEvaluation(reqs, tests, DEFAULT_RUBRIC);
    // manual/answer_key тексерілмеген → 100 емес, бірақ тексерілген бөлік толық
    const verifiedCriteria = out.criteria.filter((c) => c.verified);
    for (const c of verifiedCriteria) {
      const relevantUnverified = reqs.filter((r) => r.criterionKey === c.key && r.testMethod !== "answer_key" && r.testMethod !== "manual");
      if (relevantUnverified.length === reqs.filter((r) => r.criterionKey === c.key).length) {
        expect(c.earnedPoints).toBe(c.maxPoints);
      }
    }
    expect(out.provisionalScore).toBe(100);
  });

  it("бірдей кіріс — бірдей шығыс (детерминизм)", () => {
    const tests = reqs.map((r) => t(r.id, r.weight % 2 === 0 ? "PASS" : "PARTIAL"));
    const a = scoreEvaluation(reqs, tests, DEFAULT_RUBRIC);
    const b = scoreEvaluation(reqs, [...tests], DEFAULT_RUBRIC);
    expect(a.totalScore).toBe(b.totalScore);
    expect(a.provisionalScore).toBe(b.provisionalScore);
    expect(JSON.stringify(a.criteria)).toBe(JSON.stringify(b.criteria));
  });

  it("тексерілмеген талаптар ұпай алмайды және нөл алмайды", () => {
    const only = reqs.filter((r) => r.criterionKey === "mechanics").map((r) => t(r.id, "PASS", "s.png"));
    const out = scoreEvaluation(reqs, only, DEFAULT_RUBRIC);
    const unverified = out.criteria.filter((c) => !c.verified);
    expect(unverified.length).toBeGreaterThan(0);
    for (const c of unverified) expect(c.earnedPoints).toBe(0);
    // жабылым < 1
    expect(out.verificationCoverage).toBeLessThan(1);
    expect(out.verificationCoverage).toBeGreaterThan(0);
  });

  it("FAIL талап критерий ұпайын азайтады", () => {
    const mechReqs = reqs.filter((r) => r.criterionKey === "mechanics");
    const testsPass = mechReqs.map((r) => t(r.id, "PASS", "s.png"));
    const testsFail = mechReqs.map((r) => t(r.id, "FAIL"));
    const full = scoreEvaluation(reqs, testsPass, DEFAULT_RUBRIC);
    const failed = scoreEvaluation(reqs, testsFail, DEFAULT_RUBRIC);
    const mechFull = full.criteria.find((c) => c.key === "mechanics")!;
    const mechFail = failed.criteria.find((c) => c.key === "mechanics")!;
    expect(mechFull.earnedPoints).toBe(mechFull.maxPoints);
    expect(mechFail.earnedPoints).toBe(0);
  });

  it("PARTIAL = жарым ұпай", () => {
    const mechReqs = reqs.filter((r) => r.criterionKey === "mechanics");
    const tests = mechReqs.map((r) => t(r.id, "PARTIAL"));
    const out = scoreEvaluation(reqs, tests, DEFAULT_RUBRIC);
    const mech = out.criteria.find((c) => c.key === "mechanics")!;
    expect(mech.earnedPoints).toBe(round2(mech.maxPoints * 0.5));
  });

  it("жабылым ≥ 70% болса — расталған баға", () => {
    const tests = reqs
      .filter((r) => r.testMethod === "browser")
      .map((r) => t(r.id, "PASS", "s.png"));
    const out = scoreEvaluation(reqs, tests, DEFAULT_RUBRIC);
    if (out.verificationCoverage >= 0.7) expect(out.scoreType).toBe("confirmed");
    else expect(out.scoreType).toBe("provisional");
  });

  it("дәлел сенімділігі құжатталған формула бойынша", () => {
    const mechReqs = reqs.filter((r) => r.criterionKey === "mechanics");
    const tests = mechReqs.map((r) => t(r.id, "PASS")); // скриншотсыз
    const out = scoreEvaluation(reqs, tests, DEFAULT_RUBRIC);
    // quality = 0.6 (скриншот жоқ); confidence = 0.7*coverage + 0.3*0.6
    const expected = round2(0.7 * out.verificationCoverage + 0.3 * 0.6);
    expect(out.evidenceConfidence).toBe(expected);
  });

  it("мәлімдеме мәтінді түрде түсіндіреді", () => {
    const out = scoreEvaluation(reqs, reqs.map((r) => t(r.id, "PASS", "s.png")), DEFAULT_RUBRIC);
    const s = scoringStatement({ totalScore: out.totalScore, provisionalScore: out.provisionalScore, verificationCoverage: out.verificationCoverage, evidenceConfidence: out.evidenceConfidence }, out.scoreType);
    expect(s).toContain("ұпай");
    expect(s).toContain("%");
  });
});

describe("рубрика валидациясы", () => {
  it("әдепкі рубрика жарамды және 100 ұпай", () => {
    expect(criteriaSum(DEFAULT_RUBRIC)).toBe(100);
    expect(validateRubric(DEFAULT_RUBRIC).valid).toBe(true);
  });
  it("жиынтық 99 болса — жарамсыз", () => {
    const bad = JSON.parse(JSON.stringify(DEFAULT_RUBRIC));
    bad.criteria[0].maxPoints -= 1;
    const v = validateRubric(bad);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e: string) => e.includes("100"))).toBe(true);
  });
  it("теріс салмақ — жарамсыз", () => {
    const bad = JSON.parse(JSON.stringify(DEFAULT_RUBRIC));
    bad.criteria[0].maxPoints = -5;
    expect(validateRubric(bad).valid).toBe(false);
  });
});
