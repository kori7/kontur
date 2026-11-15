import { test, expect } from "@playwright/test";

for (const width of [320, 768, 900, 1440]) {
  test(`company identity remains visible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Насосный агрегат Н-101" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    if (width === 320) {
      await page.addStyleTag({ content: "body { max-width: 305px; }" });
    }
    const header = page.getByRole("banner");
    const logo = header.getByAltText("Логотип КОНТУР");
    await expect(logo).toBeVisible();
    expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    expect((await logo.boundingBox())!.width).toBeGreaterThanOrEqual(56);
    const company = header.getByLabel("КСТ Энерго Инжиниринг", { exact: true });
    await expect(company).toBeVisible();
    const action = header.getByRole("button", { name: width < 1200 ? "Профиль работника" : "Демосценарии", exact: true });
    const identity = header.locator(".topbar-identity");
    expect((await identity.boundingBox())!.x + (await identity.boundingBox())!.width).toBeLessThanOrEqual((await action.boundingBox())!.x);
    if (width >= 840) {
      await expect(page.locator(".nav-label-full").first()).toBeVisible();
    }
    if (width === 1440) {
      await page.screenshot({ path: ".cache/brand-desktop.jpg", type: "jpeg" });
    }
  });
}

test("sidebar keeps a text brand without demo labels", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Насосный агрегат Н-101" })).toBeVisible();
  await expect(page.locator(".sidebar .brand img")).toHaveCount(0);
  await expect(page.locator(".sidebar")).not.toContainText("Демонстрационный стенд");
  await expect(page.locator(".breadcrumb")).toHaveCount(0);
});

test("passport text and factual labels remain readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("#passport > summary").click();
  await expect(page.locator(".passport")).toBeVisible();
  const sizes = await page.locator(".passport p, .passport-grid small, .passport-grid strong").evaluateAll((elements) => elements.map((element) => parseFloat(getComputedStyle(element).fontSize)));
  expect(sizes.length).toBeGreaterThan(0);
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
});

test("the heading names the point and carries no demo notice", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Насосный агрегат Н-101" })).toBeVisible();
  // The demo pump is marked once by the scenario control; its card no longer repeats a demo notice.
  await expect(page.getByText("Карточка, телеметрия и нормативы созданы для демонстрации", { exact: false })).toHaveCount(0);
  // The point on the round is the serial number, the same rule for every object.
  await expect(page.locator(".page-heading")).toContainText("Точка: DEMO-2026-001");
  await page.screenshot({ path: ".cache/brand-mobile.jpg", type: "jpeg" });
});

for (const width of [320, 390]) {
  test(`series record count stays on one line at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await page.goto("/?screen=series");
    const count = page.getByText("500 записей", { exact: true });
    await expect(count).toBeVisible();
    const layout = await count.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
      return { lines, right: element.getBoundingClientRect().right, viewport: window.innerWidth };
    });
    expect(layout.lines).toBe(1);
    expect(layout.right).toBeLessThanOrEqual(layout.viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
