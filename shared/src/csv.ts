// CSV экспорт: қазақша бағандар, дұрыс экрандау, Excel үшін UTF-8 BOM.

export function escapeCsvValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/\r?\n/g, " ");
  if (/[",;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCsvValue).join(",")];
  for (const row of rows) lines.push(row.map(escapeCsvValue).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export const CSV_HEADERS = {
  history: [
    "Тексеру ID",
    "Студенттің аты-жөні",
    "Оқу тобы",
    "Жоба сілтемесі",
    "Репозиторий",
    "Тапсырма",
    "Күні",
    "Күйі",
    "Расталған ұпай",
    "Алдын ала баға (100-ден)",
    "Тексеру жабылымы (%)",
    "Дәлел сенімділігі (%)",
    "Рубрика нұсқасы",
  ],
  results: [
    "Тест ID",
    "Талап ID",
    "Тест атауы",
    "Күйі",
    "Басталды",
    "Аяқталды",
    "Браузер",
    "Viewport",
    "Орындалған әрекеттер",
    "Күтілетін нәтиже",
    "Нақты нәтиже",
    "Қате хабарламасы",
    "Дәлел файлы",
    "Шектеулер",
  ],
  criteria: [
    "Критерий",
    "Максимум ұпай",
    "Жиналған ұпай",
    "Тексерілді ме",
    "Түсіндірме",
    "Орындалмаған талаптар",
    "Ішінара талаптар",
    "Тексерілмеген талаптар",
  ],
} as const;
