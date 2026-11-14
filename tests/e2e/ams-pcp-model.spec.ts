import { test as base, expect } from "@playwright/test";
import { chooseObject } from "./helpers";

const test = base.extend({
  launchOptions: [async ({ browserName }, use) => {
    await use(browserName === "chromium" ? { args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {});
  }, { scope: "worker" }],
});

for (const width of [393, 834, 1440]) {
  test(`real PCP assembly has its own exterior nodes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await chooseObject(page, "pcp-21031004-1");
    const model = page.locator('.pump-model[data-model="ams-pcp"]');
    await expect(model).toHaveAttribute("data-ready", "true", { timeout: 20000 });
    await expect(model.locator("canvas")).toBeVisible();
    await expect(model.locator(".model-node")).toHaveCount(14);
    await expect(model.locator('.model-pin[data-node="rotor"], .model-pin[data-node="mechanical_seal"]')).toHaveCount(0);
    await expect(model.getByRole("button", { name: "Выбрать демосценарий", exact: true })).toHaveCount(0);
    await expect(model.getByText("О 3D-модели", { exact: true }), "Происхождение модели — справка паспорта, не осмотра").toHaveCount(0);
    await expect(page).toHaveURL(/equipment=pcp-21031004-1/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await model.getByRole("button", { name: "Показать разрез", exact: true }).click();
    await expect(model.locator("canvas")).toHaveAttribute("data-cutaway", "true");
    await model.getByRole("button", { name: "Показать разрез", exact: true }).click();
    await expect(model.locator("canvas")).toHaveAttribute("data-cutaway", "false");
  });
}

test("the passport keeps where the 3D model comes from", async ({ page }) => {
  await page.goto("/?equipment=pcp-21031004-1&screen=equipment");
  await page.getByText("О 3D-модели", { exact: true }).click();
  await expect(page.locator(".passport .model-about")).toContainText("2530 × 340 × 759");
  await expect(page.locator(".passport .model-about")).toContainText("2742 × 360 × 605");
});

test("real object survives section changes and reload", async ({ page }) => {
  await page.goto("/?equipment=pcp-21031004-2&screen=equipment");
  // The object picker lives on the overview; the passport names the object in its heading.
  await expect(page.locator(".page-heading")).toContainText("21031004-2");
  await expect(page.locator(".passport")).toContainText("21031004-2");
  await page.getByRole("button", { name: "Осмотр оборудования", exact: true }).click();
  await expect(page).toHaveURL(/equipment=pcp-21031004-2/);
  await expect(page.locator('.pump-model[data-model="ams-pcp"]')).toHaveAttribute("data-ready", "true", { timeout: 20000 });
  await page.reload();
  await expect(page).toHaveURL(/equipment=pcp-21031004-2/);
  await expect(page.locator('.pump-model[data-model="ams-pcp"]')).toHaveAttribute("data-ready", "true", { timeout: 20000 });
});

test("documented DTS temperature changes the actual stator and clears on empty data", async ({ page }) => {
  await page.goto("/?equipment=pcp-21031004-1");
  const model = page.locator('.pump-model[data-model="ams-pcp"]');
  await expect(model).toHaveAttribute("data-ready", "true", { timeout: 20000 });
  const canvas = model.locator("canvas");
  const original = await canvas.getAttribute("data-stator-color");
  await page.getByLabel("Температура датчика сухого хода DTS", { exact: false }).fill("60");
  await page.getByRole("button", { name: "Пересчитать по введённым данным" }).click();
  await expect(model.locator(".model-state-dot")).not.toHaveClass(/attention/);
  await page.getByLabel("Температура датчика сухого хода DTS", { exact: false }).fill("103");
  await page.getByRole("button", { name: "Пересчитать по введённым данным" }).click();
  await expect(canvas).toHaveAttribute("data-heat-parts", /stator/);
  await expect(canvas).not.toHaveAttribute("data-stator-color", original!);
  await expect(model.locator(".model-state-note")).toContainText("103");
  await page.getByLabel("Температура датчика сухого хода DTS", { exact: false }).fill("");
  await page.getByRole("button", { name: "Пересчитать по введённым данным" }).click();
  await expect(canvas).toHaveAttribute("data-heat-parts", "");
  await expect(canvas).toHaveAttribute("data-stator-color", original!);
  await expect(model.locator(".model-state-note")).toContainText("Нет измерений");
});

test("recorded visible defects update and reset the real guard and leakage", async ({ page }) => {
  await page.goto("/?equipment=pcp-21031004-1");
  const model=page.locator('.pump-model[data-model="ams-pcp"]');
  await expect(model).toHaveAttribute("data-ready","true",{timeout:20000});
  const canvas=model.locator("canvas");
  await page.getByLabel("Отсутствует защитный кожух").selectOption("present");
  await page.getByLabel("Чрезмерная течь в уплотнении вала").selectOption("present");
  await page.getByRole("button",{name:"Пересчитать по введённым данным"}).click();
  await expect(canvas).toHaveAttribute("data-guard-visible","false");
  await expect(canvas).toHaveAttribute("data-leak-visible","true");
  await page.getByLabel("Отсутствует защитный кожух").selectOption("unset");
  await page.getByLabel("Чрезмерная течь в уплотнении вала").selectOption("unset");
  await page.getByRole("button",{name:"Пересчитать по введённым данным"}).click();
  await expect(canvas).toHaveAttribute("data-guard-visible","true");
  await expect(canvas).toHaveAttribute("data-leak-visible","false");
});
