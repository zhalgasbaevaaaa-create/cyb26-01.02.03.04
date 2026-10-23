// CSV экспорт және талаптар матрицасының тестілері
import { describe, it, expect } from "vitest";
import { buildCsv, escapeCsvValue, CSV_HEADERS } from "../../shared/src/csv";
import { REQUIREMENTS, ASSIGNMENTS, requirementsForAssignment } from "../../shared/src/requirements";
import { DEFAULT_RUBRIC } from "../../shared/src/rubric";

describe("CSV экрандау", () => {
  it("тырнақша мен үтір экрандалады", () => {
    expect(escapeCsvValue('қате, "дәйексөз"')).toBe('"қате, ""дәйексөз"""');
  });
  it("жаңа жол алыстанады", () => {
    expect(escapeCsvValue("бірінші\nекінші")).toBe("бірінші екінші");
  });
  it("қарапайым мән өзгермейді", () => {
    expect(escapeCsvValue("Сәлем")).toBe("Сәлем");
  });
  it("BOM және CRLF", () => {
    const csv = buildCsv(["А", "Б"], [["1", "2"]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\r\n");
  });
  it("қазақша бағандар толық", () => {
    expect(CSV_HEADERS.history[0]).toBe("Тексеру ID");
    expect(CSV_HEADERS.results).toContain("Күйі");
    expect(CSV_HEADERS.criteria).toContain("Жиналған ұпай");
  });
});

describe("талаптар матрицасы (PDF дереккөзі)", () => {
  it("6 бекітілген тапсырма + 1 еркін («Басқа ойын түрі») бар", () => {
    expect(ASSIGNMENTS).toHaveLength(7);
    expect(ASSIGNMENTS.map((a) => a.id)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "OTHER"]);
  });
  it("ортақ талаптар әр тапсырмаға кіреді", () => {
    const common = REQUIREMENTS.filter((r) => r.assignmentId === "COMMON");
    expect(common.length).toBeGreaterThanOrEqual(18);
    for (const a of ASSIGNMENTS) {
      const reqs = requirementsForAssignment(a.id);
      expect(reqs.length).toBeGreaterThan(common.length);
      expect(reqs.every((r) => r.assignmentId === "COMMON" || r.assignmentId === a.id)).toBe(true);
    }
  });
  it("6 міндетті тапсырма түрі матрицада бар", () => {
    for (let i = 1; i <= 6; i++) {
      expect(REQUIREMENTS.find((r) => r.id === `C-TASK-${i}`), `C-TASK-${i}`).toBeTruthy();
    }
  });
  it("барлық талап рубрика критерийіне байланған және критерийлер рубрикада бар", () => {
    const keys = new Set(DEFAULT_RUBRIC.criteria.map((c) => c.key));
    for (const r of REQUIREMENTS) {
      expect(keys.has(r.criterionKey), `${r.id} → ${r.criterionKey}`).toBe(true);
    }
  });
  it("әр талапта түпнұсқа мәтін (PDF) сақталған", () => {
    for (const r of REQUIREMENTS) {
      expect(r.originalText.length, r.id).toBeGreaterThan(10);
      expect(r.displayText.length, r.id).toBeGreaterThan(5);
    }
  });
  it("A2 кезеңдерінің түсіндірмесі (PDF-тегі «...») оқытушыға белгіленген", () => {
    const a2levels = REQUIREMENTS.find((r) => r.id === "A2-LEVELS")!;
    expect(a2levels.verificationStatus).toBe("ambiguous");
    expect(a2levels.instructorNotes).toBeTruthy();
  });
  it("A1 кейіпкерлері PDF тізімінен (Томирис, Шырақ, ...)", () => {
    const a1 = REQUIREMENTS.find((r) => r.id === "A1-CHARS")!;
    for (const name of ["Томирис", "Шырақ", "Күлтегін", "Білге қаған", "Әл-Фараби", "Қасым хан", "Хақназар", "Абылай", "Кенесары", "Алаш"]) {
      expect(a1.originalText, name).toContain(name);
    }
  });
  it("медициналық көмек механикасы A1-де дәл PDF мәтінімен", () => {
    const medic = REQUIREMENTS.find((r) => r.id === "A1-MEDIC")!;
    expect(medic.originalText).toContain("Медициналық көмек қажет пе?");
    expect(medic.originalText).toContain("+1 өмір");
  });
  it("«жан біткенде» механикасы барлық ойынға ортақ", () => {
    const lives = REQUIREMENTS.find((r) => r.id === "C-LIVES")!;
    expect(lives.assignmentId).toBe("COMMON");
    expect(lives.required).toBe(true);
  });
});
