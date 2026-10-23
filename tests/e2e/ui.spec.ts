// Пайдаланушы интерфейсін браузер арқылы тексеру (қазақша UI + толық ағын).
import { test, expect } from "@playwright/test";

const TOKEN = "e2e-token";

test("кіру, аудит бастау, нәтиже беті және қазақша UI", async ({ page }) => {
  // Барлық беттерде JS pageerror (ұсталмаған ерекшелік) болмауын қадағалаймыз
  // (SettingsPage/ComparisonPage/RubricPage қоса — backlog талабы).
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  // 1. Кіру беті
  await page.goto("/");
  await expect(page.locator("text=GAME HUB PROJECT AUDITOR")).toBeVisible();
  await expect(page.locator("text=Жүйеге кіру")).toBeVisible();
  await expect(page.getByText("Әкімші кілті", { exact: true })).toBeVisible();

  // Қате кілт
  await page.locator("input[type=password]").fill("wrong");
  await page.locator("button", { hasText: "Кіру" }).click();
  await expect(page.locator("text=Кілт қате немесе сервер қолжетімсіз")).toBeVisible();

  // Дұрыс кілт
  await page.locator("input[type=password]").fill(TOKEN);
  await page.locator("button", { hasText: "Кіру" }).click();
  await expect(page.locator("text=Қош келдіңіз!")).toBeVisible();

  // 2. Навигация — барлық 9 бөлім қазақша
  for (const label of [
    "Басты бет", "Жаңа жобаны тексеру", "Техникалық тапсырмалар", "Тексеру тарихы",
    "Бағалау нәтижелері", "Қателер мен ұсыныстар", "Есептер", "Бағалау критерийлерін баптау", "Жүйе параметрлері",
  ]) {
    await expect(page.locator("aside", { hasText: label }).first()).toBeVisible();
  }

  // 3. Тапсырмалар беті — PDF матрицасы
  await page.locator("a.navlink", { hasText: "Техникалық тапсырмалар" }).click();
  await expect(page.locator("text=«ҚАЗАҚ ДАЛАСЫНЫҢ ҚОРҒАНЫ»").first()).toBeVisible();
  await expect(page.locator("text=Барлық 6 ойынға ортақ міндетті жүйе").first()).toBeVisible();
  await expect(page.locator("text=«ТАРИХ ІЗІМЕН»").first()).toBeVisible();

  // 4. Жаңа тексеру формасы — валидация
  await page.locator("a.navlink", { hasText: "Жаңа жобаны тексеру" }).click();
  await expect(page.locator("text=Студенттің аты-жөні")).toBeVisible();
  await page.locator("button", { hasText: "Тексеруді бастау" }).click();
  await expect(page.locator("text=Міндетті өріс").first()).toBeVisible();

  // Жарамсыз URL
  await page.locator("input[placeholder='Мысалы: Айбек Сериков']").fill("E2E Студент");
  await page.locator("input[placeholder='Мысалы: CYB26-1']").fill("CYB26-E2E");
  await page.locator("input[placeholder='https://...']").fill("ftp://жарамсыз");
  await page.locator("button", { hasText: "Тексеруді бастау" }).click();
  await expect(page.locator("text=Жарамды http:// немесе https:// сілтемесін енгізіңіз")).toBeVisible();

  // 4b. «Басқа ойын түрі» (OTHER) — жаңа еркін техникалық тапсырма режимі
  await page.locator("select").selectOption("OTHER");
  await expect(page.locator("text=Техникалық тапсырма мәтіні")).toBeVisible();
  await page.locator("button", { hasText: "Тексеруді бастау" }).click();
  await expect(page.locator("text=«Басқа ойын түрі» таңдалғанда техникалық тапсырма мәтінін")).toBeVisible();
  await page.locator("textarea").first().fill("Ойын «Томирис» кейіпкеріне негізделген, 5 кезеңнен тұрады.");
  await expect(page.locator("text=«Басқа ойын түрі» таңдалғанда техникалық тапсырма мәтінін")).not.toBeVisible();

  // 5. Нақты аудит (fixture) — А1 профиліне қайта ауысып, толық құбырды тексереміз
  await page.locator("input[placeholder='https://...']").fill("http://127.0.0.1:8788/fixture/");
  await page.locator("select").selectOption("A1");
  await page.locator("button", { hasText: "Тексеруді бастау" }).click();

  // Нәтиже бетіне өтеді; барыс көрсетіледі
  await expect(page).toHaveURL(/\/results\//);
  await expect(page.locator("text=Тексеру барысы")).toBeVisible();

  // Аяқталғанша күту (нақты backend күйі)
  await expect(page.locator("text=Аяқталды").first()).toBeVisible({ timeout: 300_000 });

  // 6. Нәтиже мазмұны қазақша
  await expect(page.locator("text=Қорытынды баға").first()).toBeVisible();
  await expect(page.locator("text=Бағалау критерийлері").first()).toBeVisible();
  await expect(page.locator("text=Орындалды").first()).toBeVisible();
  await expect(page.locator("text=Дәлелдер мен скриншоттар").first()).toBeVisible();
  await expect(page.locator("text=Ең маңызды 5 ұсыныс").first()).toBeVisible();
  await expect(page.locator("button", { hasText: "Есепті PDF форматында жүктеу" })).toBeVisible();
  await expect(page.locator("button", { hasText: "Кестені CSV форматында жүктеу" })).toBeVisible();

  // Скриншот дәлелі шынымен жүктеледі
  const img = page.locator("img[alt]").first();
  await page.locator("summary", { hasText: "Дәлелдер мен скриншоттар" }).first().click();
  await expect(img).toBeVisible();
  const natural = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
  expect(natural).toBeGreaterThan(100);

  // 7. Тарих беті
  await page.locator("a.navlink", { hasText: "Тексеру тарихы" }).click();
  await expect(page.locator("text=E2E Студент").first()).toBeVisible();

  // 8. Рубрика беті — v2.0 (10 критерий) жиынтық валидациясы + қорытынды баға деңгейлері
  await page.locator("a.navlink", { hasText: "Бағалау критерийлерін баптау" }).click();
  await expect(page.locator("text=Жиынтық 100 ұпайға тең болуы керек")).toBeVisible();
  await expect(page.locator("text=Google OAuth").first()).toBeVisible();
  await expect(page.locator("text=Киберқауіпсіздік").first()).toBeVisible();
  await expect(page.locator("text=Қорытынды баға деңгейлері (FINAL DECISION)")).toBeVisible();
  await expect(page.locator("text=Өте жоғары деңгей").first()).toBeVisible();
  await expect(page.locator("text=Қанағаттанарлық").first()).toBeVisible();

  // 9. Параметрлер беті — инфрақұрылым күйі + тест модульдерін баптау
  await page.locator("a.navlink", { hasText: "Жүйе параметрлері" }).click();
  await expect(page.locator("text=Инфрақұрылым күйі")).toBeVisible();
  await expect(page.locator("text=Playwright браузер ортасы")).toBeVisible();
  await expect(page.locator("text=SSRF қорғанысы")).toBeVisible();

  // 10. Салыстыру беті — аяқталған тексеру көрінеді және таңдауға болады
  await page.locator("a.navlink", { hasText: "Студенттерді салыстыру" }).click();
  await expect(page.locator("text=Студенттерді салыстыру").first()).toBeVisible();
  await expect(page.locator("text=E2E Студент").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("text=Салыстыру үшін жоғарыдағы кестеден жазбаларды таңдаңыз.")).toBeVisible();

  expect(pageErrors, `Беттерде ұсталмаған JS қателері болмауы керек:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("мобильді өлшемде интерфейс қолжетімді (390×844)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("input[type=password]").fill(TOKEN);
  await page.locator("button", { hasText: "Кіру" }).click();
  await expect(page.locator("text=Қош келдіңіз!")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
