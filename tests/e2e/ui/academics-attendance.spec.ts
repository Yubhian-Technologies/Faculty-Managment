import { test, expect } from "@playwright/test";

test.describe("Student Attendance Page", () => {
  test("today-periods shows current period info", async ({ page }) => {
    await page.goto("/academics/student-attendance/today-periods");
    // Should show some period info or empty state
    await expect(page.getByText(/period/i)).toBeVisible();
  });
});
