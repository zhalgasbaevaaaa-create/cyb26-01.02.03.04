// Сервер конфигурациясы — барлық құпиялар .env файлында сақталады.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadEnv } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
// .env жүктеу (жоба түбірінен). Жоқ болса — қоршаған орта айнымалылары қолданылады.
loadEnv({ path: path.join(here, "..", "..", ".env") });

const root = path.join(here, "..", "..");
// Салыстырмалы жолдар жоба түбіріне қатысты шешіледі (CWD-ге тәуелсіз болу үшін)
const resolveFromRoot = (p: string) => (path.isAbsolute(p) ? p : path.resolve(root, p));

export const CONFIG = {
  port: Number(process.env.PORT ?? 8787),
  adminToken: process.env.ADMIN_TOKEN ?? "test-admin-token",
  dataDir: resolveFromRoot(process.env.DATA_DIR ?? "data"),
  evidenceDir: resolveFromRoot(process.env.EVIDENCE_DIR ?? "data/evidence"),
  clientDist: resolveFromRoot(process.env.CLIENT_DIST ?? "client/dist"),
  fixtureDir: resolveFromRoot(process.env.FIXTURE_DIR ?? "fixtures/test-site"),
  // PDF есебі үшін қазақша Unicode қаріптер (репозиторийге салынған — ОС-тің
  // жүйелік қаріптеріне (мыс. DejaVu) тәуелді болмау үшін, Docker image-і
  // ауысқанда (мыс. Playwright base image жаңартылғанда) есеп бұзылмайды).
  fontsDir: resolveFromRoot(process.env.FONTS_DIR ?? "server/assets/fonts"),
  // НАҚТЫ ӨНДІРІСТЕ ЕШҚАШАН ҚОСПАҢЫЗ — тек осы ортадағы fixture сынақтары үшін.
  allowLocalhostForTests: process.env.ALLOW_LOCALHOST_FOR_TESTS === "1",
  maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS ?? 1),
  jobTimeoutMs: Number(process.env.JOB_TIMEOUT_MS ?? 10 * 60 * 1000),
  navTimeoutMs: Number(process.env.NAV_TIMEOUT_MS ?? 30 * 1000),
  pageActionTimeoutMs: Number(process.env.PAGE_ACTION_TIMEOUT_MS ?? 8 * 1000),
  maxNetworkRequests: Number(process.env.MAX_NETWORK_REQUESTS ?? 400),
  duplicateWindowMinutes: Number(process.env.DUPLICATE_WINDOW_MINUTES ?? 5),
  // Firebase (қосымша, бапталмаған болса JSON-файл сақтауышы қолданылады)
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? "",
  firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "",
  // Google OAuth (қосымша — аудиттелетін сайттардың өз функциясы емес,
  // бұл аудитордың өз кіру жүйесі үшін болашақ конфигурация)
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
} as const;

export function firebaseConfigured(): boolean {
  return CONFIG.firebaseProjectId !== "" && CONFIG.firebaseServiceAccount !== "";
}

export function googleOAuthConfigured(): boolean {
  return CONFIG.googleClientId !== "";
}
