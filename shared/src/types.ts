// Орталық типтер — GAME HUB PROJECT AUDITOR
// Барлық модульдер (сервер, клиент, тестілер) осы типтерді қолданады.

export type TestStatus = "PASS" | "PARTIAL" | "FAIL" | "NOT_VERIFIED" | "BLOCKED";

export type RequirementCategory =
  | "common"          // Барлық 6 ойынға ортақ міндетті талап
  | "characters"      // Кейіпкерлер жүйесі
  | "levels"          // Кезеңдер/деңгейлер жүйесі
  | "mechanics"       // Негізгі ойын механикасы
  | "history_task"    // Жанрға тән тарихи тапсырма механикасы
  | "difficulty"      // Қиындық жүйесі
  | "auth"            // Google тіркелу, профиль, сақталған нәтижелер
  | "gamehub"         // GAME HUB порталы және рейтинг
  | "security"        // Киберқауіпсіздік талаптары
  | "presentation"    // Қорғауға дайындық
  | "ui";             // Интерфейс және адаптивтілік

export type TestMethod =
  | "browser"     // Автоматты браузерлік тест (Playwright)
  | "static"      // Репозиторий/код статикалық талдауы
  | "answer_key"  // Бекітілген жауаптар кілтімен салыстыру
  | "manual"      // Оқытушының қолмен тексеруі
  | "unavailable"; // Қолжетімділік болмағандықтан тексерілмейді

export interface Requirement {
  id: string;
  assignmentId: string;              // "A1".."A6" немесе "COMMON"
  originalText: string;              // PDF-тен алынған түпнұсқа мәтін
  displayText: string;               // Интерфейсте көрсетілетін қазақша мәтін
  category: RequirementCategory;
  required: boolean;                 // Міндетті ме (PDF бойынша)
  expectedBehavior: string;          // Күтілетін мінез-құлық
  testMethod: TestMethod;
  evidenceNeeded: string;            // Қажетті дәлел
  maxScoreContribution: number;      // Максималды үлес (ақпараттық)
  verificationStatus: "planned" | "verified" | "ambiguous";
  instructorNotes?: string;          // Оқытушыға ескерту (күмән болса)
  weight: number;                    // Kriterий ішіндегі салмақ
  criterionKey: CriterionKey;        // Қай критерийге жатады
}

export type CriterionKey =
  | "mandatory_system"  // 1. Барлық міндетті жүйелік талаптар (Google OAuth, профиль, сессия) — 15
  | "history_tasks"     // 2. Алты тарихи тапсырма түрі (+ тарихи дәлдік) — 15
  | "levels_difficulty" // 3. 10 деңгей және difficulty progression — 10
  | "life_mechanic"     // 4. «Жан біткенде» білім беру механикасы — 10
  | "gamehub"           // 5. GAME HUB порталы және рейтинг — 10
  | "gameplay"          // 6. Ойын механикасы және алгоритмі — 10
  | "backend_data"      // 7. Backend, дерекқор, деректердің сақталуы — 10
  | "cybersecurity"     // 8. Киберқауіпсіздік — 10
  | "ui_responsive"     // 9. UI/UX, адаптивтілік, қолжетімділік — 5
  | "code_quality";     // 10. Код сапасы, тестілеу, аяқталғандық — 5

export interface CriterionScore {
  key: CriterionKey;
  maxPoints: number;
  earnedPoints: number;
  explanation: string;
  verified: boolean;               // Кемінде бір талап нақты тексерілді ме
  failedRequirements: string[];    // Requirement id тізімі
  partialRequirements: string[];
  unverifiedRequirements: string[];
  evidenceRefs: string[];          // TestResult id
  recommendations: string[];
}

export interface TestResult {
  id: string;
  requirementId: string;
  name: string;                    // Қазақша тест атауы
  startedAt: string;
  finishedAt: string;
  browser?: string;
  viewport?: string;
  actions: string[];               // Орындалған әрекеттер
  expected: string;
  actual: string;
  status: TestStatus;
  screenshot?: string;             // Дәлел файлына сілтеме
  error?: string;
  scoreImpact: string;             // Ұпайға әсері (мәтін)
  limitations?: string;
}

export interface Assignment {
  id: string;                       // A1..A6
  title: string;                    // «ҚАЗАҚ ДАЛАСЫНЫҢ ҚОРҒАНЫ»
  genre: string;
  profile: string;                  // Браузер тест профилінің идентификаторы
  description: string;
}

export type JobStatus =
  | "queued"        // Кезекте
  | "running"       // Орындалуда
  | "completed"     // Аяқталды
  | "failed"        // Сәтсіз аяқталды
  | "blocked"       // Бұғатталды (қауіпсіздік/қолжетімсіздік)
  | "cancelled";    // Болдырылмады

export interface JobStage {
  key: string;
  label: string;                   // Қазақша кезең атауы
  status: "pending" | "running" | "done" | "skipped" | "error";
}

/** Тексеру режимі: тек URL (black-box) немесе URL+GitHub (black-box + white-box). */
export type AuditMode = "URL_ONLY" | "URL_GITHUB";

export type FindingSeverity = "critical" | "major" | "minor";

/** Critical-fail шарты: ұпайды нөлдемейді, бірақ ерекшеескерту ретінде көрсетіледі. */
export interface CriticalFailure {
  key: string;
  message: string;                 // Қазақша түсініктеме
}

export interface EvaluationRecord {
  id: string;
  studentName: string;
  groupName: string;
  projectUrl: string;
  repositoryUrl?: string;
  assignmentId: string;
  instructorNotes?: string;
  createdAt: string;
  finishedAt?: string;
  status: JobStatus;
  stages: JobStage[];
  progress: number;                // 0..100 — нақты кезеңдерден есептеледі
  rubricVersion: string;
  mode: AuditMode;                 // MODE A (тек URL) / MODE B (URL + GitHub)
  tests: TestResult[];
  criteria: CriterionScore[];
  totalScore: number;              // Расталған ұпай (тексерілген бөлік)
  provisionalScore: number;        // Алдын ала баға (100-ге масштабталған)
  verificationCoverage: number;    // 0..1 — тексерілген талаптар үлесі
  evidenceConfidence: number;      // 0..1 — дәлел сенімділігі
  securityWarnings: string[];
  historicalNotes: string[];
  topImprovements: string[];
  limitations: string[];
  criticalFailures: CriticalFailure[]; // Critical Fail шарттары (ұпайды нөлдемейді)
  reportRefs: { pdf?: string; csv?: string };
  retestOf?: string;               // Қайта тексеру болса — алдыңғы жазба id
  previousScore?: number;          // Қайта тексеру болса — алдыңғы provisionalScore
  cancelRequested?: boolean;
}

export interface RubricCriterionDef {
  key: CriterionKey;
  label: string;
  maxPoints: number;
}

/** Қорытынды баға деңгейі («FINAL DECISION», master prompt §13), мысалы 90–100 → «Өте жоғары деңгей». */
export interface GradingBand {
  min: number;    // Осы ұпайдан (қоса алғанда) бастап осы жапсырма қолданылады
  label: string;  // Қазақша деңгей атауы
}

export interface RubricVersion {
  version: string;
  createdAt: string;
  criteria: RubricCriterionDef[];
  passThreshold: number;           // "Өтті" шегі
  provisionalThreshold: number;    // Расталған баға үшін қажетті тексеру жабылымы
  gradingBands?: GradingBand[];    // Қорытынды баға деңгейлері (бос болса — әдепкі DEFAULT_GRADING_BANDS қолданылады)
}

export interface AuditRequest {
  studentName: string;
  groupName: string;
  projectUrl: string;
  repositoryUrl?: string;
  assignmentId: string;
  instructorNotes?: string;
}
