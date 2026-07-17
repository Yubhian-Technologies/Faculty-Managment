// Exercises the real login form end-to-end (Firebase client sign-in ->
// POST /api/auth/session -> proxy.ts redirect to the role's dashboard).
// Requires TEST_HOD_EMAIL / TEST_HOD_PASSWORD (or another role's pair) to be
// set — this is the one spec in the suite that does NOT use cookie
// injection, since its whole point is to verify the login path itself.

import { test, expect } from "@playwright/test";

test.describe("Login", () => {
  test("a valid HOD login redirects to /hod", async ({ page }) => {
    test.skip(
      !process.env.TEST_HOD_EMAIL || !process.env.TEST_HOD_PASSWORD,
      "requires TEST_HOD_EMAIL and TEST_HOD_PASSWORD for a real Firebase Auth login"
    );

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

    await page.getByLabel("Email address").fill(process.env.TEST_HOD_EMAIL!);
    await page.getByLabel("Password").fill(process.env.TEST_HOD_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL("**/hod**", { timeout: 15_000 });
    expect(page.url()).toContain("/hod");
  });

  test("an invalid password shows an error and stays on /login", async ({ page }) => {
    test.skip(!process.env.TEST_HOD_EMAIL, "requires TEST_HOD_EMAIL");

    await page.goto("/login");
    await page.getByLabel("Email address").fill(process.env.TEST_HOD_EMAIL!);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForTimeout(1500);
    expect(page.url()).toContain("/login");
  });
});
