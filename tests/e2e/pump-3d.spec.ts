import { test as base, expect } from "@playwright/test";

const test = base.extend({
  launchOptions: [async ({ browserName }, use) => {
    await use(browserName === "chromium" ? { args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {});
  }, { scope: "worker" }],
});

for (const width of [320, 393, 834, 1440]) {
  test(`initial camera shows the whole assembly at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    const model = page.locator(".pump-model");
    await expect(model).toHaveAttribute("data-ready", "true", { timeout: 20000 });
    await model.getByRole("button", { name: "Показать привязки узлов", exact: true }).click();
    const canvas = model.locator("canvas");
    await canvas.evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 150));
    const screenshot = await canvas.screenshot();
    const touchingEdges = await page.evaluate(async (source) => {
      const image = new Image(); image.src = source; await image.decode();
      const buffer = document.createElement("canvas"); buffer.width = image.width; buffer.height = image.height;
      const context = buffer.getContext("2d")!; context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, buffer.width, buffer.height);
      // Fractional DOM bounds can include a neighboring CSS border in the screenshot.
      const inset = 3, origin = (inset * buffer.width + inset) * 4;
      const background = [data[origin], data[origin + 1], data[origin + 2]];
      const colored = (x: number, y: number) => {
        const offset = (y * buffer.width + x) * 4;
        return background.some((channel, index) => Math.abs(data[offset + index] - channel) > 20);
      };
      const sides: string[] = [];
      for (let y = inset; y < buffer.height - inset; y++) {
        if (colored(inset, y)) sides.push("left");
        if (colored(buffer.width - 1 - inset, y)) sides.push("right");
      }
      for (let x = inset; x < buffer.width - inset; x++) {
        if (colored(x, inset)) sides.push("top");
        if (colored(x, buffer.height - 1 - inset)) sides.push("bottom");
      }
      return [...new Set(sides)];
    }, `data:image/png;base64,${screenshot.toString("base64")}`);
    await test.info().attach("camera-framing", { body: screenshot, contentType: "image/png" });
    expect(touchingEdges, "The actual rendered pump must have space on every canvas edge").toEqual([]);
  });
}

for (const width of [320, 393, 834, 1440]) {
  test(`pump model uses full width with balanced selectors at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    const model = page.locator(".pump-model");
    await expect(model).toHaveAttribute("data-ready", "true", { timeout: 20000 });
    await expect(model.locator("canvas")).toBeVisible();
    await expect(page.getByRole("button", { name: "Развернуть схему", exact: true })).toHaveCount(0);
    const map = await page.locator(".equipment-panel").boundingBox();
    const grid = await page.locator(".inspection-grid").boundingBox();
    expect(Math.abs(map!.width - grid!.width)).toBeLessThanOrEqual(1);
    const tabs = model.locator(".model-node");
    await expect(tabs).toHaveCount(8);
    const boxes = await tabs.evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      return { y: Math.round(box.y), width: box.width, height: box.height };
    }));
    const rows = [...new Set(boxes.map(box => box.y))];
    const rowSizes = rows.map(y => boxes.filter(box => box.y === y).length);
    expect(rowSizes.every(count => count === (width < 700 ? 2 : 4))).toBe(true);
    expect(boxes.every(box => box.height >= 44 && Math.abs(box.width - boxes[0].width) <= 1)).toBe(true);
    const scene = model.locator(".model-scene");
    await scene.scrollIntoViewIfNeeded();
    const initial = Number(await scene.getAttribute("data-azimuth"));
    const bounds = (await scene.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + bounds.height * 0.5, { steps: 15 });
    await page.mouse.up();
    await expect.poll(async () => Math.abs(Number(await scene.getAttribute("data-azimuth")) - initial)).toBeGreaterThan(0.1);
    await model.getByRole("button", { name: "Исходный вид", exact: true }).click();
    const pins = await model.locator(".model-pin").evaluateAll(nodes => nodes.filter(node => !node.hidden).map(node => {
      const rect = node.getBoundingClientRect();
      const stage = node.closest(".model-scene")!.getBoundingClientRect();
      return rect.left >= stage.left - 1 && rect.right <= stage.right + 1 && rect.top >= stage.top - 1 && rect.bottom <= stage.bottom + 1;
    }));
    expect(pins.length).toBeGreaterThan(2);
    expect(pins.every(Boolean)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("phone navigation restores distinct screens and keeps labels visible", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  // Old passport links open the inspection with its passport section unfolded.
  await page.goto("/?screen=equipment");
  await expect(page.locator(".passport")).toBeVisible();
  await expect(page.locator("main h1")).toHaveText("Насосный агрегат Н-101");
  await expect(page.locator(".nav-label-short")).toHaveText(["Объекты", "Осмотр", "Журнал"]);
  for (const label of await page.locator(".nav-label-short").all()) await expect(label).toBeVisible();
  // The tabs share the bar's width equally and line up with the content's side insets.
  const tabs = await page.locator("nav .nav-item").evaluateAll(items => items.map(item => item.getBoundingClientRect()));
  const content = (await page.locator(".page-heading").boundingBox())!;
  expect(tabs.every(tab => Math.abs(tab.width - tabs[0].width) <= 1)).toBe(true);
  expect(Math.abs(tabs[0].left - content.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(tabs.at(-1)!.right - (content.x + content.width))).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Журнал осмотров", exact: true }).click();
  await expect(page.locator("main h1")).toHaveText("Журнал осмотров");
  await expect(page).toHaveURL(/screen=history/);
  await page.reload();
  await expect(page.locator("main h1")).toHaveText("Журнал осмотров");
  await page.getByRole("button", { name: "Осмотр оборудования", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Карта состояния", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/screen=overview/);
  await page.goBack();
  await expect(page.locator("main h1")).toHaveText("Журнал осмотров");
});

test("demo scenarios change actual model parts and normal clears their effects", async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 393, height: 1000 });
  await page.goto("/");
  const model = page.locator(".pump-model");
  await expect(model).toHaveAttribute("data-ready", "true", { timeout: 20000 });
  const canvas = model.locator("canvas");
  const normalInlet = await canvas.getAttribute("data-inlet-color");
  const normalPump = await canvas.getAttribute("data-pump-color");
  async function scenario(id: string) {
    // Scenarios are switched from the profile on a phone; the model card no longer repeats the switch.
    await page.getByRole("banner").getByRole("button", { name: "Профиль работника" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Демосценарии" }).click();
    await page.getByLabel("Сценарий демонстрации").selectOption(id);
    await page.getByRole("button", { name: "Применить сценарий", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await scenario("r01");
  await expect(canvas).toHaveAttribute("data-heat-parts", /bearing/);
  await expect(model.getByRole("status")).toContainText("Тепловая подсветка");
  await scenario("r02");
  await expect(canvas).not.toHaveAttribute("data-inlet-color", normalInlet!);
  await scenario("r03");
  await expect(canvas).toHaveAttribute("data-guard-opacity", "0.22");
  await scenario("r04");
  await expect(canvas).toHaveAttribute("data-pump-opacity", "0.2");
  await scenario("r05");
  await expect(canvas).not.toHaveAttribute("data-pump-color", normalPump!);
  await scenario("r06");
  await expect(canvas).toHaveAttribute("data-leak-visible", "true");
  await scenario("r11");
  await expect(canvas).toHaveAttribute("data-guard-visible", "false");
  await expect(canvas).toHaveAttribute("data-leak-visible", "false");
  await scenario("r07");
  await expect(canvas).toHaveAttribute("data-missing-bolt", "true");
  await scenario("r08");
  await expect(canvas).toHaveAttribute("data-oil-low", "true");
  await scenario("r09");
  await expect(canvas).toHaveAttribute("data-contacts-visible", "true");
  await scenario("r10");
  await expect(canvas).toHaveAttribute("data-gauge-reading", "5.5");
  await scenario("r12");
  await expect(canvas).not.toHaveAttribute("data-inlet-color", normalInlet!);
  await scenario("normal");
  await expect(canvas).toHaveAttribute("data-guard-visible", "true");
  await expect(canvas).toHaveAttribute("data-leak-visible", "false");
  await expect(canvas).toHaveAttribute("data-missing-bolt", "false");
  await expect(canvas).toHaveAttribute("data-oil-low", "false");
  await expect(canvas).toHaveAttribute("data-heat-parts", "");
  await expect(canvas).toHaveAttribute("data-gauge-reading", "4.7");
  await expect(canvas).toHaveAttribute("data-contacts-visible", "false");
  await expect(canvas).toHaveAttribute("data-pump-opacity", "1");
  await expect(canvas).toHaveAttribute("data-guard-opacity", "1");
  await scenario("missing_data");
  await expect(canvas).toHaveAttribute("data-gauge-reading", "unknown");
  await expect(model.getByRole("status")).toContainText("Недостаточно данных");
});
