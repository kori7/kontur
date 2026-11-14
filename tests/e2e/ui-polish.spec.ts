import { test, expect } from "@playwright/test";

for (const width of [320, 393, 834, 1440]) {
  test(`measurement cards align their labels and readings at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Насосный агрегат Н-101" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const positions = await page.locator(".metric-card").evaluateAll(elements => elements.map(element => {
      const card = element.getBoundingClientRect();
      return {
        label: element.querySelector(".metric-label")!.getBoundingClientRect().y - card.y,
        value: element.querySelector(".metric-main > span")!.getBoundingClientRect().y - card.y,
      };
    }));
    for (const position of positions) {
      expect(Math.abs(position.label - positions[0].label)).toBeLessThanOrEqual(1);
      expect(Math.abs(position.value - positions[0].value)).toBeLessThanOrEqual(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("phone equipment actions remain readable and fit in one row", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/");
  const inspection = page.getByRole("button", { name: "Начать осмотр", exact: true });
  const identification = page.getByRole("button", { name: "QR и AR-стенд", exact: true });
  await expect(inspection).toBeVisible();
  const main = (await inspection.boundingBox())!;
  const secondary = (await identification.boundingBox())!;
  expect(Math.abs(main.y - secondary.y)).toBeLessThanOrEqual(1);
  expect(main.width).toBeGreaterThan(secondary.width);
  expect(secondary.x - main.x - main.width).toBeGreaterThanOrEqual(8);
  expect((await page.locator(".page-heading").boundingBox())!.height).toBeLessThan(330);
  await identification.click();
  await expect(page.getByRole("dialog", { name: "Идентификация и AR-стенд" })).toBeVisible();
});

test("measurement selection announces the active chart metric", async ({ page }) => {
  await page.goto("/");
  const metrics = page.locator(".metric-card");
  await expect(metrics.first()).toHaveAttribute("aria-pressed", "true");
  await metrics.nth(1).click();
  await expect(metrics.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(metrics.first()).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".trend-panel .panel-heading p")).toContainText("Температура");
});

for (const width of [375, 393]) {
  test(`phone measurement names fit before and after selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(page.locator(".metric-card")).toHaveCount(4);
    await page.evaluate(() => document.fonts.ready);

    for (const selectTemperature of [false, true]) {
      if (selectTemperature) await page.locator(".metric-card").nth(1).click();
      const names = await page.locator(".metric-name").evaluateAll(elements => elements.map(element => {
        const bounds = element.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        const fragments = [...range.getClientRects()];
        const marker = element.parentElement!.querySelector(".metric-selection")!;
        const markerBounds = marker.getBoundingClientRect();
        return {
          text: element.textContent,
          fits: fragments.every(fragment => fragment.left >= bounds.left - 1 && fragment.right <= bounds.right + 1),
          overlapsMarker: fragments.some(fragment =>
            markerBounds.width > 0 && fragment.left < markerBounds.right && fragment.right > markerBounds.left &&
            fragment.top < markerBounds.bottom && fragment.bottom > markerBounds.top),
        };
      }));
      for (const name of names) {
        expect(name.fits, `${name.text} must fit its label`).toBe(true);
        expect(name.overlapsMarker, `${name.text} must not overlap its selection marker`).toBe(false);
      }
    }
  });
}

test("desktop measurement table shows every column without scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Ряды измерений", exact: true }).click();
  await expect(page.locator(".series-table tbody tr").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const widths = await page.locator(".series-table-wrap").evaluate(element => ({
    content: element.scrollWidth, available: element.clientWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.available);
});

test("material sections have space between their boundaries", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Материалы", exact: true }).click();
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
