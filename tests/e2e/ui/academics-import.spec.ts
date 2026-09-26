import { test, expect } from "@playwright/test";

test.describe("Academics Subjects Import", () => {
  test("import page loads without department field", async ({ page }) => {
    await page.goto("/academics/subjects/import?courseId=test-course&academicYear=2026-27");
    // Should NOT show Department selector
    const deptLabels = page.getByText("Department");
    await expect(deptLabels.first()).not.toBeVisible();
  });
});
