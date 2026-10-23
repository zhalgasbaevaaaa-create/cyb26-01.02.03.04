// Қателерді ауырлық дәрежесі бойынша топтау (Critical / Major / Minor) —
// master prompt §27.6 "ҚАТЕЛЕР" бөлімі үшін.
//
// Ереже (детерминистік, еш АИ-болжам жоқ):
//  • CRITICAL — тест FAIL күйінде ТҰР және оның requirementId-і scoring.ts-тегі
//    computeCriticalFailures() функциясы НАҚТЫ АНЫҚТАҒАН critical-fail шартымен
//    (rec.criticalFailures) тікелей байланысты (§28 тізімі).
//  • MAJOR — басқа кез келген FAIL күйіндегі тест (міндетті талап орындалмаған,
//    бірақ ол §28 critical-fail шартына жатпайды).
//  • MINOR — PARTIAL күйіндегі тест (мүмкіндік ішінара жұмыс істейді, бірақ
//    толық дәлелденбеген немесе кемшілікті).
import type { EvaluationRecord, TestResult } from "@gha/shared";

/** criticalFailure.key -> соған байланысты requirementId тізімі (scoring.ts-тегі
 *  computeCriticalFailures логикасымен сәйкес келеді — тек есеп үшін қайта қолданылады). */
const LEVELS_REQ_BY_ASSIGNMENT: Record<string, string> = {
  A1: "A1-LEVELS", A2: "A2-LEVELS", A3: "A3-ARENAS", A4: "A4-TRACKS", A5: "A5-LEVELS", A6: "A6-ROOMS",
};

function criticalFailureReqIds(key: string, assignmentId: string): string[] {
  switch (key) {
    case "no_google_auth": return ["C-GOOGLE"];
    case "no_persistence": return ["C-PERSIST", "C-GOOGLE-DATA"];
    case "no_backend": return ["C-BACKEND"];
    case "no_gamehub": return ["C-HUB-MAIN", "C-HUB-PAGES"];
    case "missing_task_types": return ["C-TASK-1", "C-TASK-2", "C-TASK-3", "C-TASK-4", "C-TASK-5", "C-TASK-6"];
    case "missing_levels": return [LEVELS_REQ_BY_ASSIGNMENT[assignmentId] ?? ""].filter(Boolean);
    case "missing_life_mechanic": return ["C-LIVES"];
    case "critical_xss": return ["C-SEC-XSS"];
    case "exposed_secret": return ["C-SEC-CLIENT", "C-SEC-REPO"];
    case "leaderboard_manipulation": return ["C-SEC-ANTICHEAT"];
    default: return [];
  }
}

export interface SeverityGroups {
  critical: TestResult[];
  major: TestResult[];
  minor: TestResult[];
}

export function classifyErrorSeverity(rec: EvaluationRecord): SeverityGroups {
  const criticalReqIds = new Set<string>();
  for (const cf of rec.criticalFailures) {
    for (const id of criticalFailureReqIds(cf.key, rec.assignmentId)) criticalReqIds.add(id);
  }
  const critical: TestResult[] = [];
  const major: TestResult[] = [];
  const minor: TestResult[] = [];
  for (const t of rec.tests) {
    if (t.status === "FAIL") {
      if (criticalReqIds.has(t.requirementId)) critical.push(t);
      else major.push(t);
    } else if (t.status === "PARTIAL") {
      minor.push(t);
    }
  }
  return { critical, major, minor };
}
