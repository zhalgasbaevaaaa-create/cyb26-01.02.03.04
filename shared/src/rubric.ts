// Бағалау рубрикасы: 10 критерий (master prompt §24), жиынтығы әрқашан 100 ұпай.
// Салмақтарды оқытушы өзгерте алады; әр тексеру өз нұсқасын сақтайды.

import type { CriterionKey, RubricVersion, GradingBand } from "./types.js";

/** Қорытынды баға бойынша деңгей белгілеу («FINAL DECISION» — master prompt §13).
 *  Оқытушы шектерді (min мәндерін) RubricPage арқылы өзгерте алады. */
export const DEFAULT_GRADING_BANDS: GradingBand[] = [
  { min: 90, label: "Өте жоғары деңгей" },
  { min: 75, label: "Жақсы" },
  { min: 60, label: "Қанағаттанарлық" },
  { min: 0, label: "Талаптарға толық сәйкес емес" },
];

/** Берілген ұпай бойынша тиісті деңгей жапсырмасын табады (ең жоғарғы сәйкес min). */
export function gradingBandLabel(score: number, bands: GradingBand[] = DEFAULT_GRADING_BANDS): string {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  for (const b of sorted) {
    if (score >= b.min) return b.label;
  }
  return sorted[sorted.length - 1]?.label ?? "";
}

export const DEFAULT_CRITERIA: { key: CriterionKey; label: string; maxPoints: number }[] = [
  { key: "mandatory_system", label: "1. Барлық міндетті жүйелік талаптар (Google OAuth, профиль, сессия, нәтиже сақталуы)", maxPoints: 15 },
  { key: "history_tasks", label: "2. Алты міндетті тарихи тапсырма түрі және тарихи мазмұн дәлдігі", maxPoints: 15 },
  { key: "levels_difficulty", label: "3. 10 деңгей жүйесі және difficulty progression", maxPoints: 10 },
  { key: "life_mechanic", label: "4. «Жан біткенде» білім беру механикасы", maxPoints: 10 },
  { key: "gamehub", label: "5. GAME HUB порталы, навигация және рейтинг жүйесі", maxPoints: 10 },
  { key: "gameplay", label: "6. Ойын механикасы және алгоритмі (game loop, прогрессия, ұпай)", maxPoints: 10 },
  { key: "backend_data", label: "7. Backend, дерекқор және деректердің сақталуы", maxPoints: 10 },
  { key: "cybersecurity", label: "8. Киберқауіпсіздік (XSS, құпиялар, HTTPS, сессия, rate limiting, anti-cheat)", maxPoints: 10 },
  { key: "ui_responsive", label: "9. UI/UX, адаптивті дизайн және қолжетімділік (accessibility)", maxPoints: 5 },
  { key: "code_quality", label: "10. Код сапасы, тестілеу және жобаның аяқталғандығы", maxPoints: 5 },
];

export const DEFAULT_RUBRIC: RubricVersion = {
  version: "v2.0",
  createdAt: new Date().toISOString(),
  criteria: DEFAULT_CRITERIA.map((c) => ({ ...c })),
  passThreshold: 60,
  provisionalThreshold: 0.7, // 70% тексеру жабылымынан жоғары болса — баға «расталған» саналады
  gradingBands: DEFAULT_GRADING_BANDS.map((b) => ({ ...b })),
};

/** Критерий кілті бойынша әдепкі қазақша атау (есептер мен UI үшін орталықтандырылған). */
export const CRITERION_LABELS: Record<CriterionKey, string> = Object.fromEntries(
  DEFAULT_CRITERIA.map((c) => [c.key, c.label]),
) as Record<CriterionKey, string>;

export function criterionLabel(key: string): string {
  return (CRITERION_LABELS as Record<string, string>)[key] ?? key;
}

export function criteriaSum(rubric: RubricVersion): number {
  return rubric.criteria.reduce((s, c) => s + c.maxPoints, 0);
}

export interface RubricValidation {
  valid: boolean;
  errors: string[];
}

export function validateRubric(rubric: RubricVersion): RubricValidation {
  const errors: string[] = [];
  const keys = new Set<CriterionKey>();
  for (const c of rubric.criteria) {
    if (!Number.isFinite(c.maxPoints) || c.maxPoints < 0 || c.maxPoints > 40) {
      errors.push(`«${c.label}» салмағы жарамсыз (0–40 аралығы керек): ${c.maxPoints}`);
    }
    if (keys.has(c.key)) errors.push(`Критерий қайталанады: ${c.key}`);
    keys.add(c.key);
  }
  for (const def of DEFAULT_CRITERIA) {
    if (!keys.has(def.key)) errors.push(`Критерий жоқ: ${def.key}`);
  }
  const sum = criteriaSum(rubric);
  if (sum !== 100) errors.push(`Жиынтық 100 болуы керек, қазір: ${sum}`);
  if (rubric.passThreshold < 0 || rubric.passThreshold > 100) {
    errors.push("«Өтті» шегі 0–100 аралығында болуы керек");
  }
  if (rubric.provisionalThreshold < 0 || rubric.provisionalThreshold > 1) {
    errors.push("Тексеру жабылымы шегі 0–1 аралығында болуы керек");
  }
  const bands = rubric.gradingBands ?? DEFAULT_GRADING_BANDS;
  if (!Array.isArray(bands) || bands.length < 2) {
    errors.push("Қорытынды баға деңгейлері (gradingBands) кемінде 2 деңгейден тұруы керек");
  } else {
    const sorted = [...bands].sort((a, b) => b.min - a.min);
    if (sorted[sorted.length - 1].min !== 0) {
      errors.push("Ең төменгі баға деңгейі 0-ден басталуы керек");
    }
    for (const b of bands) {
      if (!Number.isFinite(b.min) || b.min < 0 || b.min > 100) {
        errors.push(`Баға деңгейінің шегі жарамсыз (0–100 аралығы керек): ${b.min}`);
      }
      if (!b.label || !b.label.trim()) {
        errors.push("Баға деңгейінің атауы (label) бос болмауы керек");
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
