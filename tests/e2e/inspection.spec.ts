import { test, expect } from "@playwright/test";

test("diagnose, inspect a component, save and reopen history", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Насосный агрегат Н-101" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Демосценарии" }).click();
  await page.getByLabel("Сценарий демонстрации").selectOption("r06");
  await page.getByRole("button", { name: "Применить сценарий" }).click();
  await expect(page.getByText("R06", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Записать результат" }).click();
  await page.getByLabel("Компонент").selectOption("seal");
  await page.getByLabel("Комментарий").fill("Проверка сквозного сценария");
  await page
    .getByRole("button", { name: "Сохранить осмотр", exact: true })
    .click();
  await expect(page.locator(".toast[role=status]")).toContainText("сохранён");
  await page
    .getByRole("button", { name: "Журнал осмотров", exact: true })
    .click();
  await expect(
    page.getByText("Проверка сквозного сценария").first(),
  ).toBeVisible();
});

test("mobile layout fits without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Насосный агрегат Н-101" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('missing measurements are shown as unknown, not healthy or expired', async ({page})=>{
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Насосный агрегат Н-101'})).toBeVisible();
  await page.getByRole('button',{name:'Демосценарии'}).click();
  await page.getByLabel('Сценарий демонстрации').selectOption('missing_data');
  await page.getByRole('button',{name:'Применить сценарий'}).click();
  await expect(page.getByText('Данных недостаточно для оценки',{exact:true})).toBeVisible();
  await expect(page.getByText('Недостаточно данных о наработке',{exact:true})).toBeVisible();
});

test("manual observations accumulate and replacement resets only the selected component", async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Насосный агрегат Н-101'})).toBeVisible();
  for (const kind of ['guard_missing','liquid_leak']) {
    await page.getByRole('button',{name:'Начать осмотр'}).click();
    await page.getByText('Добавить наблюдение инженера',{exact:true}).click();
    await page.getByLabel('Визуальный признак').selectOption(kind);
    await page.getByRole('button',{name:'Учесть в диагностике'}).click();
  }
  await expect(page.getByText('R11',{exact:false}).first()).toBeVisible();
  await page.getByRole('button',{name:'Записать результат',exact:true}).click();
  await page.getByLabel('Компонент').selectOption('seal');
  await page.getByLabel('Выполненное действие').selectOption('replacement');
  await page.getByRole('button',{name:'Сохранить осмотр',exact:true}).click();
  await expect(page.locator('.toast[role=status]')).toContainText('сохранён');
  await page.getByRole('button',{name:'Открыть узел: Торцевое уплотнение'}).click();
  await expect(page.getByTestId('component-operating-hours')).toHaveText('0 ч');
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.getByRole('button',{name:'Открыть узел: Электродвигатель'}).click();
  await expect(page.getByTestId('component-operating-hours')).toHaveText('1 200 ч');
});
