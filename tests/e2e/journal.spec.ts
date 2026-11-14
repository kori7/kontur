import { test, expect } from "@playwright/test";
import { chooseObject } from "./helpers";

// The e2e server runs with sign-in off, so the signed-in user is an administrator with the master's tools.
test("master's journal shows every object, filters and the service plan", async ({ page }) => {
  await page.goto("/?screen=history");
  const plan = page.locator(".service-plan");
  await expect(plan.getByRole("heading", { name: "План ТО" })).toBeVisible();
  await expect(plan.locator("li", { hasText: "Насос Wilo" })).toContainText(/ТО через|ТО наступило/);
  await plan.getByText(/Срок не определён: \d+/).click();
  await expect(plan.locator("li", { hasText: "21031004-1" })).toContainText("Наработка неизвестна");

  const note = `e2e: журнал смены ${Date.now()}`;
  await page.getByRole("button", { name: "Осмотр оборудования", exact: true }).click();
  await page.getByRole("button", { name: "Записать результат", exact: true }).click();
  await page.getByLabel("Комментарий").fill(note);
  await page.getByRole("button", { name: "Сохранить осмотр", exact: true }).click();
  await chooseObject(page, "wilo-il65-160");
  await expect(page.getByRole("heading", { name: "Насос Wilo CronoLine-IL 65/160" })).toBeVisible();
  await page.getByRole("button", { name: "Журнал осмотров", exact: true }).click();
  await expect(page.getByText(note)).toHaveCount(0);
  await page.getByRole("button", { name: "Все объекты", exact: true }).click();
  const row = page.locator(".history-item", { hasText: note });
  await expect(row).toContainText("Насосный агрегат Н-101");
  await page.getByLabel("Действие").selectOption("maintenance");
  await expect(page.getByText(note)).toHaveCount(0);
});

test("an engineer's manual observation is written to the journal", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Начать осмотр" }).click();
  await page.getByText("Добавить наблюдение инженера", { exact: true }).click();
  await page.getByLabel("Визуальный признак").selectOption("guard_missing");
  await page.getByLabel("Наличие признака").selectOption("false");
  await page.getByRole("button", { name: "Учесть в диагностике" }).click();
  await expect(page.locator(".toast")).toContainText("записано в журнал");
  await page.getByRole("button", { name: "Журнал осмотров", exact: true }).click();
  await expect(page.locator(".history-item").first()).toContainText("Наблюдение инженера: кожух отсутствует — не наблюдается");
});
