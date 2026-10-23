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
  | "compliance"      // 1. Тапсырмаға сәйкестік және толықтық — 20
  | "mechanics"       // 2. Негізгі механика және кезеңдер — 15
  | "history_tasks"   // 3. Тарихи тапсырмалар және форматтар — 15
  | "auth_profile"    // 4. Аутентификация, профиль, сақталған нәтиже — 15
  | "gamehub"         // 5. GAME HUB және рейтинг — 10
  | "backend_security"// 6. Backend және қауіпсіздік — 10
  | "ui_responsive"   // 7. UI және адаптивтілік — 5
  | "history_accuracy"// 8. Тарихи контент дәлдігі — 5
  | "code_quality";   // 9. Код сапасы, тестілеу, презентация — 5

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
  reportRefs: { pdf?: string; csv?: string };
  retestOf?: string;               // Қайта тексеру болса — алдыңғы жазба id
  cancelRequested?: boolean;
}

export interface RubricCriterionDef {
  key: CriterionKey;
  label: string;
  maxPoints: number;
}

export interface RubricVersion {
  version: string;
  createdAt: string;
  criteria: RubricCriterionDef[];
  passThreshold: number;           // "Өтті" шегі
  provisionalThreshold: number;    // Расталған баға үшін қажетті тексеру жабылымы
}

export interface AuditRequest {
  studentName: string;
  groupName: string;
  projectUrl: string;
  repositoryUrl?: string;
  assignmentId: string;
  instructorNotes?: string;
}
