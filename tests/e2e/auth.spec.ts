import { test, expect } from "@playwright/test";

// The e2e server runs with sign-in off; these scenarios stand in for the server's sign-in answers.
const engineer = { id: "u1", email: "ivan@plant.local", name: "Иван Обходчик", role: "engineer",
  role_name: "Инженер", active: true, permissions: ["inspect", "record"] };

test("sign-in form leads to a workspace without service screens for an engineer", async ({ page }) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { auth_enabled: true, setup_required: false, user: null } }));
  await page.route("**/api/auth/login", (route) => route.fulfill({ json: engineer }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Вход" })).toBeVisible();
  await page.getByLabel("Почта").fill("ivan@plant.local");
  await page.getByLabel("Пароль").fill("not-a-real-password");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByRole("heading", { name: "Насосный агрегат Н-101" })).toBeVisible();
  await expect(page.locator(".nav-label-short")).toHaveText(["Объекты", "Осмотр", "Журнал"]);
  await expect(page.getByRole("button", { name: "Ряды измерений" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Материалы" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Правила диагностики" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Цифровой паспорт" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Опознать" })).toBeVisible();
  await page.getByRole("button", { name: "Журнал осмотров" }).click();
  await expect(page.getByRole("button", { name: "Все объекты" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "План ТО" })).toHaveCount(0);
  await page.getByRole("button", { name: "Осмотр оборудования" }).click();
  await page.getByRole("button", { name: "Записать результат" }).click();
  await expect(page.getByLabel("Выполненное действие").locator("option")).toHaveText(["Проверка", "Замечание"]);
});

test("first run asks for an administrator", async ({ page }) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { auth_enabled: true, setup_required: true, user: null } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Первый запуск: администратор" })).toBeVisible();
  await expect(page.getByLabel("Имя и фамилия")).toBeVisible();
});

test("wrong password is reported without leaving the form", async ({ page }) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { auth_enabled: true, setup_required: false, user: null } }));
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({ status: 401, json: { detail: "Неверная почта или пароль" } }));
  await page.goto("/");
  await page.getByLabel("Почта").fill("ivan@plant.local");
  await page.getByLabel("Пароль").fill("wrong");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByRole("alert")).toContainText("Неверная почта или пароль");
});
