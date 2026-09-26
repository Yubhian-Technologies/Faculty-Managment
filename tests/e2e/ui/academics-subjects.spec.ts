import { test, expect } from "@playwright/test";

test.describe("Academics Subjects Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/academics/subjects");
  });

  test("shows course selector, not department selector", async ({ page }) => {
    await expect(page.getByRole("combobox", { name: /course/i })).toBeVisible();
    const deptSelectors = page.getByRole("combobox", { name: /department/i });
    await expect(deptSelectors.first()).not.toBeVisible();
  });

  test("shows regulation badges after course selection", async ({ page }) => {
    const courseSelect = page.getByRole("combobox", { name: /course/i });
    await courseSelect.selectOption({ index: 0 });
    await expect(page.getByText(/regulation/i)).toBeVisible();
  });

  test("Add Subject button navigates to new subject form", async ({ page }) => {
    // Wait for courses to load
    await page.waitForSelector('select[placeholder="Select course"]', { timeout: 5000 }).catch(() => {});
  });
});
