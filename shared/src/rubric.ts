// Бағалау рубрикасы: 9 критерий, жиынтығы әрқашан 100 ұпай.
// Салмақтарды оқытушы өзгерте алады; әр тексеру өз нұсқасын сақтайды.

import type { CriterionKey, RubricVersion } from "./types.js";

export const DEFAULT_CRITERIA: { key: CriterionKey; label: string; maxPoints: number }[] = [
  { key: "compliance", label: "Тапсырмаға сәйкестік және ойынның толықтығы", maxPoints: 20 },
  { key: "mechanics", label: "Негізгі ойын механикасы және кезеңдер", maxPoints: 15 },
  { key: "history_tasks", label: "Тарихи тапсырмалар және міндетті тапсырма форматтары", maxPoints: 15 },
  { key: "auth_profile", label: "Аутентификация, профиль және сақталған нәтижелер", maxPoints: 15 },
  { key: "gamehub", label: "GAME HUB порталы және рейтинг жүйесі", maxPoints: 10 },
  { key: "backend_security", label: "Backend жүзеге асырылуы және қауіпсіздік", maxPoints: 10 },
  { key: "ui_responsive", label: "Пайдаланушы интерфейсі және адаптивті дизайн", maxPoints: 5 },
  { key: "history_accuracy", label: "Тарихи контенттің дәлдігі", maxPoints: 5 },
  { key: "code_quality", label: "Код сапасы, тестілеу және презентацияға дайындық", maxPoints: 5 },
];

export const DEFAULT_RUBRIC: RubricVersion = {
  version: "v1.0",
  createdAt: new Date().toISOString(),
  criteria: DEFAULT_CRITERIA.map((c) => ({ ...c })),
  passThreshold: 60,
  provisionalThreshold: 0.7, // 70% тексеру жабылымынан жоғары болса — баға «расталған» саналады
};

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
  return { valid: errors.length === 0, errors };
}
