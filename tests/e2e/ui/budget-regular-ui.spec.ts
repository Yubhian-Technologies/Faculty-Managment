// UI smoke test for Flow A (BUD-A-27 in the QA plan): HOD submits a budget
// request through the real form, Principal verifies it through the real
// detail dialog, Finance approves it through the real approvals card — and
// the status pill is checked at each stop. Uses cookie injection (see
// tests/e2e/support/session.ts) to switch role per browser context instead
// of three real Firebase logins, since the login path itself is already
// covered by tests/e2e/ui/login.spec.ts.

import { test, expect } from "@playwright/test";
import { loginAsViaCookie } from "../support/session";
import { testUsers } from "../support/testUsers";

test("HOD -> Principal -> Finance happy path is reflected correctly in the UI", async ({ browser, baseURL }) => {
  const title = `Playwright UI Budget ${Date.now()}`;

  // ── HOD submits ──────────────────────────────────────────────────────
  const hodContext = await browser.newContext();
  await loginAsViaCookie(hodContext, testUsers.hod, baseURL);
  const hodPage = await hodContext.newPage();
  await hodPage.goto("/hod/budget");

  await hodPage.getByRole("button", { name: "New Budget Request" }).click();
  await hodPage.getByLabel("Budget Title *").fill(title);
  await hodPage.getByLabel("Academic Year *").fill("2026-27");

  // First category group defaults to a select — pick a Non-Recurring category.
  await hodPage.getByLabel("Category *").first().selectOption({ label: "Lab Equipment" });
  const firstRow = hodPage.locator("table tbody tr").first();
  await firstRow.getByPlaceholder("e.g. Oscilloscope").fill("Playwright Oscilloscope");
  await firstRow.getByPlaceholder("Brief description").fill("Automated UI test item");
  await firstRow.locator('input[type="number"]').first().fill("15000");

  await hodPage.getByRole("button", { name: "Submit Budget Request" }).click();
  await expect(hodPage.getByText(title)).toBeVisible({ timeout: 10_000 });
  await hodContext.close();

  // ── Principal verifies ───────────────────────────────────────────────
  const principalContext = await browser.newContext();
  await loginAsViaCookie(principalContext, testUsers.principal, baseURL);
  const principalPage = await principalContext.newPage();
  await principalPage.goto("/principal/budget");
  await principalPage.getByText(title).click();
  await principalPage.getByRole("button", { name: "Verify & Freeze (L1)" }).click();
  await expect(principalPage.getByText(/level 1 freeze|l1_frozen/i)).toBeVisible({ timeout: 10_000 });
  await principalContext.close();

  // ── Finance approves ─────────────────────────────────────────────────
  const financeContext = await browser.newContext();
  await loginAsViaCookie(financeContext, testUsers.finance, baseURL);
  const financePage = await financeContext.newPage();
  await financePage.goto("/finance/budget-approvals");
  const row = financePage.getByText(title).locator("..");
  await row.getByRole("button", { name: "Approve" }).click();
  await financePage.getByLabel("Financial Year").fill("2026-27");
  await financePage.getByRole("button", { name: "Confirm Approve" }).click();
  await expect(financePage.getByText(/approved by finance/i)).toBeVisible({ timeout: 10_000 });
  await financeContext.close();
});
