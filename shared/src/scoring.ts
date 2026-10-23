// Детерминистік 100-ұпайлық бағалау қозғалтқышы.
// Бірдей дәлелдер + бірдей рубрика нұсқасы = әрқашан бірдей ұпай.
//
// Есептеу әдісі (құжатталған, қайталанатын):
// 1. Әр талаптың күйі оның тестілерінен анықталады:
//    FAIL бар → FAIL; әйтпесе PARTIAL бар → PARTIAL; әйтпесе PASS бар → PASS;
//    ақпараттық тест жоқ → BLOCKED (бұғатталған тест болса) немесе NOT_VERIFIED.
// 2. Күй коэффициенті: PASS = 1, PARTIAL = 0.5, FAIL = 0.
//    NOT_VERIFIED және BLOCKED есепке кірмейді (ұпай да берілмейді, нөл де қойылмайды).
// 3. Критерий ұпайы = maxPoints × Σ(салмақ×коэф) / Σ(тексерілген талаптар салмағы).
// 4. Расталған ұпай (totalScore) = критерийлердің қосындысы (тек тексерілген бөлік).
// 5. Алдын ала баға (provisionalScore) = totalScore / тексерілген критерийлердің
//    максимумы × 100 (тексерілмеген критерийлер тексерілгендердің орташа деңгейінде
//    деп болжанады — бұл ашық болжам, кепілдік емес).
// 6. Тексеру жабылымы = тексерілген талаптар салмағы / барлық талаптар салмағы.
// 7. Дәлел сенімділігі = 0.7 × жабылым + 0.3 × дәлел сапасы,
//    мұнда дәлел сапасы = скриншоты бар тестілер үлесі (скриншотсыз = 0.6, бар = 1.0).

import type {
  CriterionScore,
  EvaluationRecord,
  Requirement,
  RubricVersion,
  TestResult,
  TestStatus,
} from "./types.js";

export const STATUS_FACTOR: Record<TestStatus, number | null> = {
  PASS: 1,
  PARTIAL: 0.5,
  FAIL: 0,
  NOT_VERIFIED: null,
  BLOCKED: null,
};

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Талаптың жиынтық күйін оның тестілерінен шығару. */
export function requirementStatus(requirementId: string, tests: TestResult[]): TestStatus {
  const own = tests.filter((t) => t.requirementId === requirementId);
  if (own.length === 0) return "NOT_VERIFIED";
  const statuses = own.map((t) => t.status);
  if (statuses.includes("FAIL")) return "FAIL";
  if (statuses.includes("PARTIAL")) return "PARTIAL";
  if (statuses.includes("PASS")) return "PASS";
  if (statuses.includes("BLOCKED")) return "BLOCKED";
  return "NOT_VERIFIED";
}

export interface ScoringOutput {
  criteria: CriterionScore[];
  totalScore: number;
  provisionalScore: number;
  verificationCoverage: number;
  evidenceConfidence: number;
  topImprovements: string[];
  limitations: string[];
  scoreType: "confirmed" | "provisional";
}

export function scoreEvaluation(
  requirements: Requirement[],
  tests: TestResult[],
  rubric: RubricVersion,
): ScoringOutput {
  const criteria: CriterionScore[] = [];
  let totalScore = 0;
  let verifiedMax = 0;
  let allWeight = 0;
  let verifiedWeight = 0;
  let evidenceQualitySum = 0;
  const limitations: string[] = [];
  const improvementCandidates: { text: string; weight: number }[] = [];

  for (const def of rubric.criteria) {
    const reqs = requirements.filter((r) => r.criterionKey === def.key);
    const failed: string[] = [];
    const partial: string[] = [];
    const unverified: string[] = [];
    const evidenceRefs: string[] = [];
    let wSum = 0;
    let wVerified = 0;
    let weighted = 0;

    for (const req of reqs) {
      allWeight += req.weight;
      const st = requirementStatus(req.id, tests);
      const reqTests = tests.filter((t) => t.requirementId === req.id);
      evidenceRefs.push(...reqTests.map((t) => t.id));
      const factor = STATUS_FACTOR[st];
      if (factor === null) {
        unverified.push(req.id);
        if (st === "BLOCKED") {
          const blockedTest = reqTests.find((t) => t.status === "BLOCKED");
          limitations.push(`«${req.displayText}» бұғатталды: ${blockedTest?.limitations ?? "техникалық шектеу"}`);
        } else {
          limitations.push(`«${req.displayText}» тексерілмеді: дәлел жеткіліксіз немесе қолжетімділік жоқ.`);
        }
        improvementCandidates.push({ text: req.displayText, weight: req.weight });
        continue;
      }
      wSum += req.weight;
      wVerified += req.weight;
      verifiedWeight += req.weight;
      weighted += req.weight * factor;
      const hasScreenshot = reqTests.some((t) => !!t.screenshot);
      evidenceQualitySum += req.weight * (hasScreenshot ? 1 : 0.6);
      if (st === "FAIL") failed.push(req.id);
      if (st === "PARTIAL") partial.push(req.id);
      if (st === "FAIL") improvementCandidates.push({ text: req.displayText, weight: req.weight * 2 });
      if (st === "PARTIAL") improvementCandidates.push({ text: req.displayText, weight: req.weight });
    }

    const verified = wVerified > 0;
    const earned = verified ? round2((def.maxPoints * weighted) / wSum) : 0;
    if (verified) {
      totalScore += earned;
      verifiedMax += def.maxPoints;
    }

    let explanation: string;
    if (!verified) {
      explanation =
        reqs.length === 0
          ? "Бұл тапсырмада осы критерийге жататын талап жоқ."
          : "Бұл критерийдің ешбір талабы нақты тексерілмеді — ұпай берілмеді де, нөл де қойылмады.";
    } else {
      const parts: string[] = [`${reqs.length} талаптың ${wVerified > 0 ? reqs.length - unverified.length : 0}-і тексерілді`];
      if (failed.length) parts.push(`${failed.length} талап орындалмады`);
      if (partial.length) parts.push(`${partial.length} талап ішінара орындалды`);
      if (unverified.length) parts.push(`${unverified.length} талап тексерілмеді (ұпайға әсер етпеді)`);
      explanation = parts.join("; ") + ".";
    }

    const recommendations: string[] = [];
    for (const id of failed) recommendations.push(recommendationFor(requirements, id));
    for (const id of partial) recommendations.push(recommendationFor(requirements, id));

    criteria.push({
      key: def.key,
      maxPoints: def.maxPoints,
      earnedPoints: verified ? earned : 0,
      explanation,
      verified,
      failedRequirements: failed,
      partialRequirements: partial,
      unverifiedRequirements: unverified,
      evidenceRefs: [...new Set(evidenceRefs)],
      recommendations,
    });
  }

  const coverage = allWeight > 0 ? round2(verifiedWeight / allWeight) : 0;
  const evidenceQuality = verifiedWeight > 0 ? evidenceQualitySum / verifiedWeight : 0;
  const evidenceConfidence = round2(0.7 * coverage + 0.3 * round2(evidenceQuality));
  const provisionalScore = verifiedMax > 0 ? round2((totalScore / verifiedMax) * 100) : 0;
  const totalScoreRounded = round2(totalScore);

  improvementCandidates.sort((a, b) => b.weight - a.weight);
  const topImprovements = [...new Set(improvementCandidates.map((c) => c.text))].slice(0, 5);

  return {
    criteria,
    totalScore: totalScoreRounded,
    provisionalScore,
    verificationCoverage: coverage,
    evidenceConfidence,
    topImprovements,
    limitations: [...new Set(limitations)],
    scoreType: coverage >= rubric.provisionalThreshold ? "confirmed" : "provisional",
  };
}

function recommendationFor(reqs: Requirement[], id: string): string {
  const req = reqs.find((r) => r.id === id);
  if (!req) return id;
  return `${req.displayText} — күтілетін мінез-құлық: ${req.expectedBehavior}`;
}

/** Қорытынды мәлімдеме: бағаның қалай есептелгенін түсіндіреді. */
export function scoringStatement(rec: Pick<EvaluationRecord, "totalScore" | "provisionalScore" | "verificationCoverage" | "evidenceConfidence">, scoreType: string): string {
  const type = scoreType === "confirmed" ? "Расталған баға" : "Алдын ала баға";
  return (
    `Қорытынды: ${rec.totalScore} ұпай (тексерілген критерийлер бойынша). ` +
    `${type}: ${rec.provisionalScore}/100. ` +
    `Тексеру жабылымы: ${Math.round(rec.verificationCoverage * 100)}%. ` +
    `Дәлел сенімділігі: ${Math.round(rec.evidenceConfidence * 100)}% ` +
    `(әдіс: 0.7×жабылым + 0.3×скриншот сапасы — бұл статистикалық кепілдік емес). ` +
    `Тексерілмеген талаптарға ұпай берілмеді және нөл қойылмады; ` +
    `алдын ала баға тексерілген критерийлердің орташа деңгейін 100 ұпайға масштабтайды.`
  );
}
