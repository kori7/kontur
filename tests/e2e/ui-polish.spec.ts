import { test, expect } from "@playwright/test";

for (const width of [320, 393, 834, 1440]) {
  test(`reading rows keep names and values in their columns at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Насосный агрегат Н-101" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const rows = await page.locator("#readings .reading").evaluateAll(elements => elements.map(element => {
      const row = element.getBoundingClientRect();
      const name = element.querySelector(".reading-label")!.getBoundingClientRect();
      const value = element.querySelector(".reading-value")!.getBoundingClientRect();
      return { nameLeft: name.left - row.left, valueRight: row.right - value.right, overlap: name.right > value.left + 1 };
    }));
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(Math.abs(row.nameLeft - rows[0].nameLeft)).toBeLessThanOrEqual(1);
      expect(Math.abs(row.valueRight - rows[0].valueRight)).toBeLessThanOrEqual(1);
      expect(row.overlap).toBe(false);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("phone equipment actions remain readable and fit in one row", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/");
  const inspection = page.getByRole("button", { name: "Начать осмотр", exact: true });
  const identification = page.getByRole("button", { name: "Опознать", exact: true });
  await expect(inspection).toBeVisible();
  const main = (await inspection.boundingBox())!;
  const secondary = (await identification.boundingBox())!;
  expect(Math.abs(main.y - secondary.y)).toBeLessThanOrEqual(1);
  expect(main.width).toBeGreaterThan(secondary.width);
  expect(secondary.x - main.x - main.width).toBeGreaterThanOrEqual(8);
  expect((await page.locator(".page-heading").boundingBox())!.height).toBeLessThan(330);
  await identification.click();
  await expect(page.getByRole("dialog", { name: "Визуальный осмотр" })).toBeVisible();
});

test("measurement selection announces the active chart metric", async ({ page }) => {
  await page.goto("/");
  const metrics = page.locator(".reading-metric");
  await expect(metrics).toHaveCount(4);
  await expect(metrics.first()).toHaveAttribute("aria-pressed", "true");
  await metrics.nth(1).click();
  await expect(metrics.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(metrics.first()).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".trend-panel .panel-heading p")).toContainText("Температура");
});

test("desktop measurement table shows every column without scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.goto("/?screen=series");
  await expect(page.locator(".series-table tbody tr").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const widths = await page.locator(".series-table-wrap").evaluate(element => ({
    content: element.scrollWidth, available: element.clientWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.available);
});

test("material sections have space between their boundaries", async ({ page }) => {
  await page.goto("/");
  await page.goto("/?screen=library");
  await expect(page.getByRole("heading", { name: "Изображения", exact: true })).toBeVisible();
  const sections = page.locator("main > section.panel");
  await expect(sections).toHaveCount(3);
  const bounds = await sections.evaluateAll(elements => elements.map(element => {
    const { top, bottom } = element.getBoundingClientRect();
    return { top, bottom };
  }));
  for (let i = 1; i < bounds.length; i++) {
    expect(bounds[i].top - bounds[i - 1].bottom).toBeGreaterThanOrEqual(24);
  }
});
