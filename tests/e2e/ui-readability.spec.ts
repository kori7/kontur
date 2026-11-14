import { test, expect } from "@playwright/test";

for (const width of [393, 834, 1194]) {
  test(`support text and panel metadata align at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Насосный агрегат Н-101" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const unit = page.getByText("моточасов", { exact: true });
    expect(await unit.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    await expect(unit).toHaveClass(/support-copy/);
    for (const title of ["Карта состояния", "Динамика измерений"]) {
      const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
      const heading = panel.locator(".panel-heading > div");
      const badge = panel.locator(".panel-heading > .tag");
      if (title === "Карта состояния") {
        await expect(badge).toHaveCount(0);
        continue;
      }
      expect(Math.abs((await heading.boundingBox())!.x - (await badge.boundingBox())!.x)).toBeLessThanOrEqual(1);
      expect((await badge.boundingBox())!.height).toBeLessThanOrEqual(48);
    }
    const baseline = await page.locator(".resource-number").evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element.firstChild!);
      return range.getBoundingClientRect().left;
    });
    for (const selector of [".resource-range", ".service-next strong", ".service-next p", ".resource-caveat"]) {
      expect(Math.abs((await page.locator(selector).first().boundingBox())!.x - baseline)).toBeLessThanOrEqual(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("mobile worker profile provides access to demo settings", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Насосный агрегат Н-101" })).toBeVisible();
  const header = page.getByRole("banner");
  await expect(header.getByRole("button", { name: "Демосценарии", exact: true })).not.toBeVisible();
  await header.getByRole("button", { name: "Профиль работника", exact: true }).click();
  const profile = page.getByRole("dialog", { name: "Профиль работника", exact: true });
  await expect(profile).toBeVisible();
  await expect(profile.locator("img")).toHaveJSProperty("complete", true);
  await profile.getByRole("button", { name: "Демосценарии", exact: true }).click();
  await expect(page.getByLabel("Сценарий демонстрации")).toBeVisible();
});

test("AR stand instructions share the readable support style", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/?screen=equipment");
  await page.getByRole("button", { name: "QR и AR-стенд", exact: true }).click();
  const instruction = page.locator(".stand-preview p");
  await expect(instruction).toHaveClass(/support-copy/);
  const styles = await instruction.evaluate((element) => ({ size: parseFloat(getComputedStyle(element).fontSize), color: getComputedStyle(element).color }));
  expect(styles.size).toBeGreaterThanOrEqual(16);
  expect(styles.color).toBe("rgb(49, 49, 50)");
});

test("supporting labels use the same style across site sections", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Насосный агрегат Н-101" })).toBeVisible();
  for (const selector of [".inspection-bottom > span", ".equipment-type", ".model-view-controls p"]) {
    const label = page.locator(selector).first();
    await expect(label).toHaveClass(/support-copy/);
    expect(await label.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  }
  const canvas = await page.locator(".model-scene").boundingBox();
  const diagram = await page.locator(".pump-model").boundingBox();
  expect(canvas!.width).toBeLessThanOrEqual(diagram!.width);
  expect(canvas!.x).toBeGreaterThanOrEqual(diagram!.x);
  await page.getByRole("button", { name: "Журнал осмотров", exact: true }).click();
  await expect(page.locator(".history-meta").first()).toHaveClass(/support-copy/);
  await page.goto("/?screen=series");
  await expect(page.getByText("Ряд", { exact: true })).toHaveClass(/support-copy/);
});

test("chart labels retain a readable rendered height on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/");
  const labels = page.locator(".trend-chart text");
  await expect(labels.first()).toBeVisible();
  const heights = await labels.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(12);
});

test("chart sizing recovers after measurements become available again", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/");
  await expect(page.locator(".trend-chart")).toBeVisible();
  for (const scenario of ["missing_data", "normal"]) {
    await page.getByRole("banner").getByRole("button", { name: "Профиль работника" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Демосценарии" }).click();
    await page.getByLabel("Сценарий демонстрации").selectOption(scenario);
    await page.getByRole("button", { name: "Применить сценарий" }).click();
    if (scenario === "missing_data") {
      await expect(page.locator(".chart-empty")).toBeVisible();
    } else {
      await expect(page.locator(".trend-chart text").first()).toBeVisible();
    }
  }
  await page.setViewportSize({ width: 360, height: 852 });
  await expect.poll(() => page.locator(".trend-chart").evaluate((element: SVGSVGElement) => {
    const style = getComputedStyle(element);
    const contentWidth = element.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return Math.abs(element.viewBox.baseVal.width - contentWidth);
  })).toBeLessThanOrEqual(1);
  await expect.poll(async () => Math.min(...await page.locator(".trend-chart text").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height)))).toBeGreaterThanOrEqual(12);
});
