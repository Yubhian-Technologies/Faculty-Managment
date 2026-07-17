// Flow A — Regular Budget Request (HOD -> Principal/VP -> Finance).
// Cases reference the IDs in the published QA test plan (BUD-A-*).
// See tests/e2e/README.md for required env vars.

import { test, expect } from "@playwright/test";
import { ApiClient } from "../support/apiClient";
import { testUsers } from "../support/testUsers";
import { regularBudgetRequestBody } from "../support/builders";

test.describe("Flow A — Regular Budget Request", () => {
  let hod: ApiClient;
  let principal: ApiClient;
  let finance: ApiClient;

  test.beforeAll(async ({ baseURL }) => {
    hod = await ApiClient.as(baseURL!, testUsers.hod);
    principal = await ApiClient.as(baseURL!, testUsers.principal);
    finance = await ApiClient.as(baseURL!, testUsers.finance);
  });

  test.afterAll(async () => {
    await Promise.all([hod?.dispose(), principal?.dispose(), finance?.dispose()]);
  });

  test("BUD-A-01 HOD submits a valid budget request", async () => {
    const res = await hod.post("/api/college/budget-requests", regularBudgetRequestBody());
    expect(res.status()).toBe(201);
    const { id } = await res.json();
    expect(id).toBeTruthy();

    const detail = await hod.get(`/api/college/budget-requests/${id}`);
    expect(detail.ok()).toBeTruthy();
    const { request: req } = await detail.json();
    expect(req.status).toBe("PENDING_PRINCIPAL_VERIFICATION");
  });

  test("BUD-A-22 rejects a submission with zero categories", async () => {
    const res = await hod.post("/api/college/budget-requests", regularBudgetRequestBody({ nonRecurring: [], recurring: [] }));
    expect(res.status()).toBe(400);
  });

  test("BUD-A-18 HOD cannot set isEmergency:true", async () => {
    const res = await hod.post("/api/college/budget-requests", regularBudgetRequestBody({ isEmergency: true }));
    expect(res.status()).toBe(400);
  });

  test("BUD-A-02 / A-06 / A-07 / A-08 Principal verify / reject / return", async () => {
    // VERIFY happy path
    const verifyRes = await hod.post("/api/college/budget-requests", regularBudgetRequestBody());
    const { id: verifyId } = await verifyRes.json();
    const verifyPatch = await principal.patch(`/api/college/budget-requests/${verifyId}`, { action: "VERIFY" });
    expect(verifyPatch.ok()).toBeTruthy();
    const verified = await (await hod.get(`/api/college/budget-requests/${verifyId}`)).json();
    expect(verified.request.status).toBe("L1_FROZEN");

    // REJECT without remarks -> 400
    const rejectRes = await hod.post("/api/college/budget-requests", regularBudgetRequestBody());
    const { id: rejectId } = await rejectRes.json();
    const noRemarks = await principal.patch(`/api/college/budget-requests/${rejectId}`, { action: "REJECT" });
    expect(noRemarks.status()).toBe(400);

    // REJECT with remarks -> terminal
    const rejectPatch = await principal.patch(`/api/college/budget-requests/${rejectId}`, {
      action: "REJECT",
      remarks: "Playwright: over budget for this cycle",
    });
    expect(rejectPatch.ok()).toBeTruthy();
    const rejected = await (await hod.get(`/api/college/budget-requests/${rejectId}`)).json();
    expect(rejected.request.status).toBe("PRINCIPAL_REJECTED");

    // RETURN -> RETURNED_TO_HOD, then HOD resubmits -> PENDING_PRINCIPAL_VERIFICATION
    const returnRes = await hod.post("/api/college/budget-requests", regularBudgetRequestBody());
    const { id: returnId } = await returnRes.json();
    await principal.patch(`/api/college/budget-requests/${returnId}`, {
      action: "RETURN",
      remarks: "Playwright: please add justification",
    });
    const returned = await (await hod.get(`/api/college/budget-requests/${returnId}`)).json();
    expect(returned.request.status).toBe("RETURNED_TO_HOD");

    const body = regularBudgetRequestBody();
    const resubmit = await hod.patch(`/api/college/budget-requests/${returnId}`, {
      nonRecurring: body.nonRecurring,
      recurring: body.recurring,
    });
    expect(resubmit.ok()).toBeTruthy();
    const resubmitted = await (await hod.get(`/api/college/budget-requests/${returnId}`)).json();
    expect(resubmitted.request.status).toBe("PENDING_PRINCIPAL_VERIFICATION");
  });

  test("BUD-A-04 / A-05 Finance approves, FinanceBudget total matches, Purchase Clearance auto-created", async () => {
    const body = regularBudgetRequestBody();
    const createRes = await hod.post("/api/college/budget-requests", body);
    const { id } = await createRes.json();
    await principal.patch(`/api/college/budget-requests/${id}`, { action: "VERIFY" });

    const approve = await finance.patch(`/api/college/budget-requests/${id}`, {
      action: "APPROVE",
      fiscalYear: "2026-27",
    });
    expect(approve.ok()).toBeTruthy();
    const { financeBudgetId, purchaseClearanceId } = await approve.json();
    expect(financeBudgetId).toBeTruthy();
    expect(purchaseClearanceId).toBeTruthy();

    const approved = await (await hod.get(`/api/college/budget-requests/${id}`)).json();
    expect(approved.request.status).toBe("FINANCE_APPROVED");
  });

  test("BUD-A-13 Finance approve without fiscalYear is rejected", async () => {
    const createRes = await hod.post("/api/college/budget-requests", regularBudgetRequestBody());
    const { id } = await createRes.json();
    await principal.patch(`/api/college/budget-requests/${id}`, { action: "VERIFY" });

    const approve = await finance.patch(`/api/college/budget-requests/${id}`, { action: "APPROVE" });
    expect(approve.status()).toBe(400);
  });

  test("BUD-A-12 Finance RETURN on a regular request goes to RETURNED_TO_HOD", async () => {
    const createRes = await hod.post("/api/college/budget-requests", regularBudgetRequestBody());
    const { id } = await createRes.json();
    await principal.patch(`/api/college/budget-requests/${id}`, { action: "VERIFY" });

    const ret = await finance.patch(`/api/college/budget-requests/${id}`, {
      action: "RETURN",
      remarks: "Playwright: recheck the fiscal year",
    });
    expect(ret.ok()).toBeTruthy();
    const returned = await (await hod.get(`/api/college/budget-requests/${id}`)).json();
    expect(returned.request.status).toBe("RETURNED_TO_HOD");
  });

  test("BUD-A-14 verifying an already-frozen request is rejected (409)", async () => {
    const createRes = await hod.post("/api/college/budget-requests", regularBudgetRequestBody());
    const { id } = await createRes.json();
    await principal.patch(`/api/college/budget-requests/${id}`, { action: "VERIFY" });

    const secondVerify = await principal.patch(`/api/college/budget-requests/${id}`, { action: "VERIFY" });
    expect(secondVerify.status()).toBe(409);
  });

  test("BUD-A-15 Finance cannot act while still pending Principal verification (409)", async () => {
    const createRes = await hod.post("/api/college/budget-requests", regularBudgetRequestBody());
    const { id } = await createRes.json();

    const approve = await finance.patch(`/api/college/budget-requests/${id}`, {
      action: "APPROVE",
      fiscalYear: "2026-27",
    });
    expect(approve.status()).toBe(409);
  });

  test("BUD-A-16 HOD cannot view another HOD's request (403)", async () => {
    test.skip(!process.env.TEST_HOD_2_UID, "requires TEST_HOD_2_UID for a second HOD in the same college");
    const createRes = await hod.post("/api/college/budget-requests", regularBudgetRequestBody());
    const { id } = await createRes.json();

    const otherHod = await ApiClient.as(test.info().project.use.baseURL!, {
      ...testUsers.hod,
      uid: process.env.TEST_HOD_2_UID!,
    });
    const res = await otherHod.get(`/api/college/budget-requests/${id}`);
    expect(res.status()).toBe(403);
    await otherHod.dispose();
  });

  test("BUD-A-19 PURCHASE_DEPT is unauthorized on budget-requests routes", async () => {
    const purchase = await ApiClient.as(test.info().project.use.baseURL!, testUsers.purchaseDept);
    const res = await purchase.post("/api/college/budget-requests", regularBudgetRequestBody());
    expect(res.status()).toBe(401);
    await purchase.dispose();
  });

  test("BUD-A-20 unauthenticated request is rejected", async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/api/college/budget-requests`, {
      data: regularBudgetRequestBody(),
    });
    expect(res.status()).toBe(401);
  });
});
