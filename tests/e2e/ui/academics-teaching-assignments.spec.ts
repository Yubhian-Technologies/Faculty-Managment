import { test, expect } from "@playwright/test";

test.describe("HOD Teaching Assignments Page", () => {
  test("semester picker is visible", async ({ page }) => {
    await page.goto("/hod/teaching-assignments");
    await expect(page.getByRole("combobox", { name: /semester/i })).toBeVisible();
  });
});
