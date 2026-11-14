import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: ["**/ui-readability.spec.ts", "**/brand-layout.spec.ts", "**/ui-refinements.spec.ts"],
  projects: [{ name: "webkit", use: { ...devices["iPhone 15"], browserName: "webkit" } }],
});
