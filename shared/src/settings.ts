// Әкімшінің баптай алатын тест модульдері мен таймауттары.
// «Тест модулі» — executor.ts-тегі нақты тексеру кезеңдерінің ішкі жиыны
// (validate/load/browser/requirements/scoring/report кезеңдері міндетті —
// оларды өшіру мүмкін емес, себебі олар пайплайнның өзегі).

export type TestModuleKey =
  | "ui"
  | "mechanics"
  | "history"
  | "levels"
  | "auth"
  | "backend"
  | "gamehub"
  | "security"
  | "repo";

export const TEST_MODULE_KEYS: TestModuleKey[] = [
  "ui",
  "mechanics",
  "history",
  "levels",
  "auth",
  "backend",
  "gamehub",
  "security",
  "repo",
];

export const TEST_MODULE_LABELS: Record<TestModuleKey, string> = {
  ui: "Интерфейсті және навигацияны тексеру (+ адаптивтілік, accessibility)",
  mechanics: "Ойын механикасын тексеру",
  history: "6 тарихи тапсырманы тексеру",
  levels: "10 деңгей жүйесін тексеру",
  auth: "Google авторизациясын тексеру",
  backend: "Backend және деректердің сақталуын тексеру",
  gamehub: "GAME HUB порталы мен Leaderboard тексеру",
  security: "Security аудиті",
  repo: "Source-code аудиті (GitHub берілсе)",
};

export interface ModuleTimeouts {
  navTimeoutMs: number;         // Бетті жүктеу таймауты
  pageActionTimeoutMs: number;  // Әрбір әрекет (клик, енгізу) таймауты
  jobTimeoutMs: number;         // Бүкіл тексерудің жалпы таймауты
}

export interface ModuleSettings {
  enabledModules: Record<TestModuleKey, boolean>;
  timeouts: ModuleTimeouts;
  updatedAt: string;
}

export const DEFAULT_MODULE_SETTINGS: ModuleSettings = {
  enabledModules: {
    ui: true,
    mechanics: true,
    history: true,
    levels: true,
    auth: true,
    backend: true,
    gamehub: true,
    security: true,
    repo: true,
  },
  timeouts: {
    navTimeoutMs: 30_000,
    pageActionTimeoutMs: 8_000,
    jobTimeoutMs: 10 * 60 * 1000,
  },
  updatedAt: "1970-01-01T00:00:00.000Z",
};

export function validateModuleSettings(s: ModuleSettings): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const k of TEST_MODULE_KEYS) {
    if (typeof s.enabledModules?.[k] !== "boolean") errors.push(`Модуль күйі көрсетілмеген: ${k}`);
  }
  const { navTimeoutMs, pageActionTimeoutMs, jobTimeoutMs } = s.timeouts ?? ({} as ModuleTimeouts);
  if (!(navTimeoutMs >= 2_000 && navTimeoutMs <= 120_000)) errors.push("navTimeoutMs 2000–120000 аралығында болуы керек");
  if (!(pageActionTimeoutMs >= 1_000 && pageActionTimeoutMs <= 60_000)) errors.push("pageActionTimeoutMs 1000–60000 аралығында болуы керек");
  if (!(jobTimeoutMs >= 30_000 && jobTimeoutMs <= 30 * 60 * 1000)) errors.push("jobTimeoutMs 30000–1800000 аралығында болуы керек");
  return { valid: errors.length === 0, errors };
}
