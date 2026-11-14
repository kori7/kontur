import { test, expect, type Page } from "@playwright/test";

// Stage B screens. Objects are split by test so repeated runs against one database stay
// independent: recording an inspection closes the weekly rule P05 for that object, so the
// journal test writes to -2 and the empty-inspection test reads -4, which nothing writes to.
const PCP_NAME = "Агрегат насосный одновинтовой эксцентриковый";

async function openObject(page: Page, id: string, serial: string) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Насосный агрегат Н-101" }),
  ).toBeVisible();
  await page.getByLabel("Объект осмотра").selectOption(id);
  await expect(page.getByRole("heading", { name: PCP_NAME })).toBeVisible();
  await expect(page.getByText(serial, { exact: false }).first()).toBeVisible();
}

test("switching to a documented object replaces demo telemetry with passport data", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.locator('option[value="tag-860-P-0201"]'),
    "Позиция по проекту покрывает два агрегата и выбрать её для осмотра нельзя.",
  ).toBeDisabled();
  await openObject(page, "pcp-21031004-1", "21031004-1");

  await expect(
    page.getByRole("button", { name: "Демосценарии" }),
    "Демосценарии принадлежат pump-101 и на паспортном объекте не предлагаются.",
  ).toHaveCount(0);
  await expect(page.getByText("Входы осмотра")).toBeVisible();
  const resource = page.locator(".service-panel", {
    hasText: "Значения паспорта изготовителя",
  });
  await expect(resource).toBeVisible();
  await expect(
    resource.locator("li", { hasText: "Ресурс до списания" }),
  ).toContainText(/не менее 11\s000 ч/);
  await expect(resource.locator("li", { hasText: "Срок службы" })).toContainText("20 лет");
  await expect(
    page.getByText("Графа «Дата ввода в эксплуатацию» в паспорте не заполнена", {
      exact: false,
    }),
  ).toBeVisible();
});

test("dry-run temperature above the setpoint raises P01 with its source", async ({
  page,
}) => {
  await openObject(page, "pcp-21031004-1", "21031004-1");
  await page
    .getByLabel("Температура датчика сухого хода DTS", { exact: false })
    .fill("103");
  await page
    .getByRole("button", { name: "Пересчитать по введённым данным" })
    .click();
  await expect(page.getByRole("status")).toContainText("пересчитан");

  const finding = page.getByRole("button", {
    name: /Достигнута уставка защиты от сухого хода/,
  });
  await expect(finding).toBeVisible();
  await expect(page.getByText("Обнаружены признаки высокого риска")).toBeVisible();

  await finding.click();
  await expect(page.getByText("Температура DTS, °C")).toBeVisible();
  await expect(page.getByText(/manuals-017/).first()).toBeVisible();
});

test("an empty inspection of a documented object never reads as normal", async ({
  page,
}) => {
  await openObject(page, "pcp-21031004-4", "21031004-4");
  await expect(page.getByText("Данных недостаточно для оценки")).toBeVisible();
  await expect(
    page.getByText("Отклонений по доступным данным нет"),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Правила диагностики" }).click();
  const p01 = page.locator(".rule-row", { hasText: "P01" });
  await expect(p01).toContainText("Достигнута уставка защиты от сухого хода");
  await expect(p01).toContainText("Основание: manuals-017");
  await expect(p01).toContainText("Нет данных");
  await expect(page.locator(".rule-row")).toHaveCount(8);
  await expect(
    page.locator(".rule-status.clear"),
    "Без входов ни одно правило не вправе ответить «не сработало».",
  ).toHaveCount(0);
});

test("history recorded on one object stays out of another object's journal", async ({
  page,
}) => {
  const note = `e2e: отдельная история ${Date.now()}`;
  await openObject(page, "pcp-21031004-2", "21031004-2");
  await page
    .getByRole("button", { name: "Записать результат", exact: true })
    .click();
  await page.getByLabel("Компонент").selectOption("stator");
  await page.getByLabel("Комментарий").fill(note);
  await page.getByRole("button", { name: "Сохранить осмотр", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("сохранён");

  await page.getByRole("button", { name: "Журнал осмотров", exact: true }).click();
  await expect(page.getByText(note)).toBeVisible();

  // The object picker lives on the overview only.
  await page.getByRole("button", { name: "Обзор оборудования", exact: true }).click();
  await page.getByLabel("Объект осмотра").selectOption("pump-101");
  await expect(
    page.getByRole("heading", { name: "Насосный агрегат Н-101" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Журнал осмотров", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Журнал осмотров" })).toBeVisible();
  await expect(page.getByText(note)).toHaveCount(0);
});

test("series replay agrees with the organizer's own label at an alarm", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Ряды измерений" }).click();
  await expect(
    page.getByRole("heading", { name: "Ряды измерений", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("подключены телеметрией основного агрегата Wilo", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Объект осмотра"),
    "Ряды организатора не привязаны к объекту, и выбор объекта здесь не показывается.",
  ).toHaveCount(0);
  await expect(page.getByText(/Записи 491–500 из 500/)).toBeVisible();

  // Twenty steps back put record 299 last: 2x crosses the organizer's alarm there.
  let end = 499;
  for (let step = 0; step < 20; step += 1) {
    await page.getByRole("button", { name: /Раньше/ }).click();
    end -= 10;
    await expect(
      page.getByText(new RegExp(`Записи ${end - 8}–${end + 1} из 500`)),
    ).toBeVisible();
  }
  const twoX = page.locator(".assessment-list li", { hasText: "Ампл. 2x" });
  await expect(twoX).toContainText("Выше тревоги");
  await expect(
    page.locator(".series-table tbody tr").last(),
  ).toContainText("Тревога: Расцентровка");

  const hf = page.locator(".assessment-list li", { hasText: "ВЧ шум" });
  await expect(hf, "Ускорение остаётся в g, а не в мм/с.").toContainText("g");
  await expect(
    page.locator(".assessment-list li", { hasText: "Темп. подшипника" }),
    "Вибрационный ряд не оценивается по температурным уставкам.",
  ).toHaveCount(0);
});

test("materials library shows provenance and serves the original file", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Материалы" }).click();
  await expect(
    page.getByRole("heading", { name: "Переданные материалы" }).first(),
  ).toBeVisible();
  await expect(page.locator(".library-totals")).toContainText("Всего файлов84");

  await expect(page.locator(".library-card")).toHaveCount(12);
  await page.getByRole("button", { name: "Показать все 55" }).click();
  const stock = page.locator(".library-card", { hasText: "pipes-009" });
  await expect(stock).toContainText("Сток с водяным знаком");
  await expect(stock).toContainText("Исключён");
  await expect(
    page.locator(".library-card", { hasText: "valves-008" }),
  ).toContainText("Повтор pumps-011");

  await page.getByRole("button", { name: "Допущены в выборку" }).click();
  await expect(page.locator(".library-card")).toHaveCount(24);
  await expect(page.locator(".library-card", { hasText: "pipes-009" })).toHaveCount(0);

  await page.locator(".library-card", { hasText: "pumps-013" }).click();
  const preview = page.getByRole("dialog", { name: "Просмотр файла pumps-013" });
  await expect(preview).toBeVisible();
  await expect(preview.locator("img")).toHaveJSProperty("complete", true);
  expect(
    await preview.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth),
    "Файл должен реально отдаваться через API, а не только значиться в списке.",
  ).toBeGreaterThan(0);

  const response = await page.request.get("/api/library/..%2F..%2Fetc%2Fpasswd/file");
  expect(response.status(), "Путь из запроса не принимается.").toBe(404);
});

for (const screen of ["Ряды измерений", "Материалы"]) {
  test(`${screen}: mobile layout fits without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: screen }).click();
    await expect(page.locator(".panel").first()).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
