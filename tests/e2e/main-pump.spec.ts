import { test, expect } from "@playwright/test";
import { chooseObject } from "./helpers";

test("main pump replays the organizer's series beside their diagnosis", async ({ page }) => {
  await page.goto("/");
  await chooseObject(page, "wilo-il65-160");
  await expect(page.getByRole("heading", { name: "Насос Wilo CronoLine-IL 65/160" })).toBeVisible();
  const panel = page.locator(".series-telemetry");
  await expect(panel).toContainText("Запись 500 из 500");
  await expect(panel.locator(".series-compare")).toContainText("Перегрев обмоток двигателя");
  await expect(panel.locator(".series-compare")).toContainText("Тревога: Перегрев обмоток ЭД");
  await expect(panel.locator(".series-value.critical")).toContainText("Обмотки двигателя");
  await page.getByRole("button", { name: "Предыдущая запись" }).click();
  await expect(panel).toContainText("Запись 499 из 500");
  await expect(panel.locator(".series-hours")).toContainText("Наработка в работе: 499 ч");
  await expect(panel.locator(".service-steps li")).toHaveCount(3);
});
