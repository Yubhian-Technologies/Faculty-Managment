import { test, expect } from "@playwright/test";

test.describe("Assign Semester Page", () => {
  test("shows course selection without department step", async ({ page }) => {
    await page.goto("/academics/assign-semester");
    // Should show course → regulation → semester flow
    await expect(page.getByRole("combobox", { name: /course/i })).toBeVisible();
    // Should NOT show department selector
    const deptSelectors = page.getByRole("combobox", { name: /department/i });
    await expect(deptSelectors.first()).not.toBeVisible();
  });
});
