// Cross-cutting session/tenancy cases (SEC-*) applicable across all four flows.

import { test, expect } from "@playwright/test";
import { ApiClient } from "../support/apiClient";
import { testUsers } from "../support/testUsers";
import { regularBudgetRequestBody } from "../support/builders";

test.describe("Cross-cutting — session & tenancy", () => {
  test("SEC-02 an expired session cookie is treated as unauthenticated", async ({ request, baseURL }) => {
    const expiredPayload = {
      uid: testUsers.hod.uid,
      email: testUsers.hod.email,
      role: "HOD",
      collegeId: testUsers.hod.collegeId,
      locationId: "",
      exp: Math.floor(Date.now() / 1000) - 3600, // expired 1h ago
    };
    const cookieValue = `header.${Buffer.from(JSON.stringify(expiredPayload)).toString("base64")}.signature`;

    const res = await request.get(`${baseURL}/api/college/budget-requests`, {
      headers: { Cookie: `fms-session=${cookieValue}` },
    });
    expect(res.status()).toBe(401);
  });

  test("SEC-04 FINANCE without a ?collegeId= fallback gets NO_COLLEGE_CONTEXT (401)", async ({ baseURL }) => {
    const financeNoCollege = await ApiClient.as(baseURL!, { ...testUsers.finance, collegeId: "" });
    const res = await financeNoCollege.raw.get(`${baseURL}/api/college/finance-budget-requests`);
    expect(res.status()).toBe(401);
    await financeNoCollege.dispose();
  });

  test("SEC-03 a request cannot be fetched through a mismatched college id", async ({ baseURL }) => {
    test.skip(!process.env.TEST_COLLEGE_ID_OTHER, "requires TEST_COLLEGE_ID_OTHER (a second seeded college)");
    const hod = await ApiClient.as(baseURL!, testUsers.hod);
    const createRes = await hod.post("/api/college/budget-requests", regularBudgetRequestBody());
    const { id } = await createRes.json();

    const otherCollegeHod = await ApiClient.as(baseURL!, {
      ...testUsers.hod,
      collegeId: process.env.TEST_COLLEGE_ID_OTHER!,
    });
    const res = await otherCollegeHod.get(`/api/college/budget-requests/${id}`);
    expect(res.status()).toBe(404); // request lives under the original college's subcollection, not this one

    await hod.dispose();
    await otherCollegeHod.dispose();
  });
});
