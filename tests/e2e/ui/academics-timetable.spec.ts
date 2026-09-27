import { test, expect } from "@playwright/test";

test.describe("Timetable Page", () => {
  test("semester picker is visible", async ({ page }) => {
    await page.goto("/principal/timetable");
    await expect(page.getByRole("combobox", { name: /semester/i })).toBeVisible();
  });
});
