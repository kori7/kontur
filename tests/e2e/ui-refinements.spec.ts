import { test, expect } from "@playwright/test";

test("stand text is centered within its horizontal rules", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const label = page.locator(".workspace-tag .support-copy");
  await expect(label).toHaveCSS("text-align", "center");
  const alignment = await label.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const frame = element.parentElement!.getBoundingClientRect();
    return { x: Math.abs((text.left + text.right) / 2 - (frame.left + frame.right) / 2), y: Math.abs((text.top + text.bottom) / 2 - (frame.top + frame.bottom) / 2) };
  });
  expect(alignment.x).toBeLessThanOrEqual(1);
  expect(alignment.y).toBeLessThanOrEqual(2);
});

test("materials omit duplicate counters in the summary", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Материалы", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Переданные материалы", exact: true })).toBeVisible();
  await expect(page.getByText("84 файлов", { exact: true })).toHaveCount(0);
  await expect(page.locator(".panel-heading").filter({ has: page.getByRole("heading", { name: "Переданные материалы", exact: true }) }).locator(".tag")).toHaveCount(0);
  await expect(page.locator(".library-totals")).not.toContainText("уникальных 52");
  await expect(page.locator(".library-totals > div").first().locator("strong")).toHaveText("55");
});

for (const width of [393, 834, 1440]) {
  test(`series assessment columns align at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: "Ряды измерений", exact: true }).click();
    await expect(page.locator(".assessment-result").first()).toBeVisible();
    const rows = await page.locator(".series-assessment li").evaluateAll(elements => elements.map(element => {
      const name = element.querySelector(".assessment-name")!.getBoundingClientRect();
      const result = element.querySelector(".assessment-result")!.getBoundingClientRect();
      const details = element.querySelector(".assessment-thresholds")!.getBoundingClientRect();
      return { nameX: name.x, resultX: result.x, offset: result.y - name.y, detailsY: details.y, resultBottom: result.bottom, nameBottom: name.bottom };
    }));
    for (const row of rows) {
      expect(Math.abs(row.nameX - rows[0].nameX)).toBeLessThanOrEqual(1);
      expect(Math.abs(row.resultX - rows[0].resultX)).toBeLessThanOrEqual(1);
      expect(Math.abs(row.offset - rows[0].offset)).toBeLessThanOrEqual(1);
      expect(row.detailsY).toBeGreaterThanOrEqual(Math.max(row.resultBottom, row.nameBottom));
    }
    await expect(page.locator("main")).not.toContainText("floating_clock_technical_utc_coordinate");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("displayed prose omits terminal periods and retains internal punctuation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Насосный агрегат Н-101" })).toBeVisible();
  await expect(page.getByText("Карточка, телеметрия и нормативы созданы для демонстрации. Требования изготовителя не подтверждены", { exact: true })).toBeVisible();
  for (const title of ["Обзор оборудования", "Цифровой паспорт", "Журнал осмотров", "Правила диагностики", "Ряды измерений", "Материалы"]) {
    await page.getByRole("button", { name: title, exact: true }).click();
    await page.waitForLoadState("networkidle");
    const terminalPeriods = await page.locator("main p, main small, .series-limits li").evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().height && /\.$/.test(element.textContent!.trim())).map(element => element.textContent!.trim()));
    expect(terminalPeriods, title).toEqual([]);
  }
  await page.getByRole("button", { name: "Ряды измерений", exact: true }).click();
  await expect(page.locator(".assessment-thresholds").first()).toContainText("≥ 2.8");
});
