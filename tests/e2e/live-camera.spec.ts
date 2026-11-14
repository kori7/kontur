import { test, expect, type Page } from "@playwright/test";

// A canvas stands in for the phone camera: a red rectangle at a known place in a 1280×720 frame.
async function fakeCamera(page: Page) {
  await page.addInitScript(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d")!;
    setInterval(() => {
      context.fillStyle = "#345";
      context.fillRect(0, 0, 1280, 720);
      context.fillStyle = "#e33";
      context.fillRect(320, 180, 640, 360);
    }, 100);
    const stream = canvas.captureStream(15);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: async () => stream },
    });
  });
}

// Frames still go to the real server; only its (empty) answer gets one box over the rectangle.
async function boxOverRectangle(page: Page) {
  await page.route("**/api/live/sessions/*/frames/*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.detections = [
      { kind: "test", label: "Проверка рамки", bbox: [0.25, 0.25, 0.75, 0.75], confidence: 0.9, confirmed: true },
    ];
    await route.fulfill({ response, json: body });
  });
}

async function startLive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Начать осмотр" }).click();
  await expect(page.getByRole("button", { name: "Загрузить снимок" })).toHaveCount(0);
  await page.getByRole("button", { name: "Включить камеру" }).click();
  await expect(page.getByRole("status").filter({ hasText: "обработано" })).toBeVisible();
}

async function expectBoxOnRectangle(page: Page) {
  const box = page.locator(".live-frame .vision-box");
  await expect(box).toContainText("Проверка рамки · 90%");
  const [video, drawn] = await Promise.all([
    page.locator(".live-frame video").boundingBox(),
    box.boundingBox(),
  ]);
  expect(video && drawn).toBeTruthy();
  expect(drawn!.x).toBeCloseTo(video!.x + video!.width * 0.25, 0);
  expect(drawn!.y).toBeCloseTo(video!.y + video!.height * 0.25, 0);
  expect(drawn!.width).toBeCloseTo(video!.width * 0.5, 0);
  expect(drawn!.height).toBeCloseTo(video!.height * 0.5, 0);
}

test("live inspection says plainly that no detector is connected", async ({ page }) => {
  await fakeCamera(page);
  await startLive(page);
  await expect(page.getByRole("status").filter({ hasText: "обработано" })).toContainText(
    "Детектор признаков не подключён",
  );
  await expect(page.locator(".live-assessment")).toHaveText("Детектор не готов — оценить кадр нельзя");
  await expect(page.locator(".live-frame .vision-box")).toHaveCount(0);
  await page.getByRole("button", { name: "Остановить" }).click();
  await expect(page.getByRole("button", { name: "Включить камеру" })).toBeVisible();
});

test("boxes land on the video on a phone and on a wide screen", async ({ page }) => {
  await fakeCamera(page);
  await boxOverRectangle(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await startLive(page);
  await expectBoxOnRectangle(page);
  // Wide screen: the video is limited by height, so its width shrinks with it.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expectBoxOnRectangle(page);
});

// The server's real answer, with one confirmed "guard missing" box over the rectangle.
async function confirmedGuard(page: Page) {
  await page.route("**/api/live/sessions/*/frames/*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.detections = [{ kind: "guard_missing", label: "Нет кожуха муфты", bbox: [0.25, 0.25, 0.75, 0.75],
                         confidence: 0.81, confirmed: true }];
    body.assessment = "possible_defect";
    body.confirmed_kinds = ["guard_missing"];
    await route.fulfill({ response, json: body });
  });
}

test("hints name components from triggered rules", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Демосценарии" }).click();
  await page.getByLabel("Сценарий демонстрации").selectOption("r06");
  await page.getByRole("button", { name: "Применить сценарий" }).click();
  await page.getByRole("button", { name: "Начать осмотр" }).click();
  await expect(page.locator(".live-hints")).toContainText("Куда навести камеру");
  await expect(page.locator(".live-hints li").first()).toContainText("Утечка через торцевое уплотнение");
});

test("a confirmed sign is recorded in the journal with its frame", async ({ page }) => {
  await fakeCamera(page);
  await confirmedGuard(page);
  await startLive(page);
  await expect(page.locator(".live-assessment")).toContainText("Обнаружены признаки возможного дефекта: Нет кожуха муфты");
  await page.getByRole("button", { name: "Подтвердить и записать" }).click();
  await expect(page.locator(".live-candidate")).toContainText("Записано в журнал");
  await expect(page.getByRole("status").filter({ hasText: "Записано в журнал:" })).toContainText("Нет кожуха муфты");
  await page.getByRole("button", { name: "Остановить" }).click();
  await page.getByRole("button", { name: "Закрыть" }).click();
  await page.getByRole("button", { name: "Журнал осмотров", exact: true }).click();
  const entry = page.locator(".history-item").filter({ hasText: "признак найден камерой" }).first();
  await expect(entry).toBeVisible();
  await expect(entry.locator("img")).toHaveCount(1);
});

test("tapping a box opens the component it belongs to", async ({ page }) => {
  await fakeCamera(page);
  await confirmedGuard(page);
  await startLive(page);
  await page.getByRole("button", { name: "Нет кожуха муфты: открыть карточку узла" }).click();
  await expect(page.getByRole("heading", { name: "Визуальный осмотр" })).toHaveCount(0);
});

test("a read nameplate opens the card of the object it names", async ({ page }) => {
  await fakeCamera(page);
  await page.addInitScript(() => {
    (navigator.mediaDevices as MediaDevices & { enumerateDevices: () => Promise<MediaDeviceInfo[]> })
      .enumerateDevices = async () => [{ deviceId: "fake", kind: "videoinput", label: "fake", groupId: "g" } as MediaDeviceInfo];
  });
  await page.route("**/api/nameplate", (route) => route.fulfill({ json: {
    status: "found", lines: ["21031004-1"],
    matches: [{ id: "pcp-21031004-1", name: "Насосный агрегат 21031004-1", serial: "21031004-1", matched: "serial" }] } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Начать осмотр" }).click();
  await page.getByRole("button", { name: "Опознать" }).click();
  await page.getByRole("button", { name: "Включить камеру" }).click();
  await page.getByRole("button", { name: "Прочитать шильдик" }).click();
  await expect(page.getByRole("heading", { name: "Визуальный осмотр" })).toHaveCount(0);
  await expect(page.locator("select").first()).toHaveValue("pcp-21031004-1");
});
