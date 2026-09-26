import { test, expect } from "@playwright/test";

test.describe("Academic Dashboard Reports", () => {
  test("Faculty attendance completion page loads", async ({ page }) => {
    await page.goto("/faculty-attendance-completion");
    await expect(page.getByText(/faculty/i)).toBeVisible();
  });

  test("Section attendance report page loads", async ({ page }) => {
    await page.goto("/section-attendance-report");
    await expect(page.getByText(/attendance/i)).toBeVisible();
  });
});
