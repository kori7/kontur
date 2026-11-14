import { expect, type Page } from "@playwright/test";

/** Pick an object the way a user does: the «Объекты» tab, then the object's row. */
export async function chooseObject(page: Page, id: string) {
  await page.getByRole("button", { name: "Объекты", exact: true }).click();
  await page.locator(`[data-object="${id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`equipment=${id}(&|$)`));
  await expect(page.locator("main h1")).not.toHaveText("Объекты");
}
