// Flow B — Emergency Budget Request (Principal/VP -> Management -> Finance).
// Cases reference the IDs in the published QA test plan (BUD-B-*).

import { test, expect } from "@playwright/test";
import { ApiClient } from "../support/apiClient";
import { testUsers } from "../support/testUsers";
import { emergencyBudgetRequestBody } from "../support/builders";

test.describe("Flow B — Emergency Budget Request", () => {
  let hod: ApiClient;
  let principal: ApiClient;
  let finance: ApiClient;
  let management: ApiClient;

  test.beforeAll(async ({ baseURL }) => {
    hod = await ApiClient.as(baseURL!, testUsers.hod);
    principal = await ApiClient.as(baseURL!, testUsers.principal);
    finance = await ApiClient.as(baseURL!, testUsers.finance);
    management = await ApiClient.as(baseURL!, testUsers.management);
  });

  test.afterAll(async () => {
    await Promise.all([hod?.dispose(), principal?.dispose(), finance?.dispose(), management?.dispose()]);
  });

  test("BUD-B-03 HOD cannot raise an emergency request (400)", async () => {
    const res = await hod.post("/api/college/budget-requests", emergencyBudgetRequestBody("GOODS"));
    expect(res.status()).toBe(400);
  });

  test("BUD-B-04 Principal submitting without isEmergency:true is rejected (400)", async () => {
    const res = await principal.post("/api/college/budget-requests", {
      ...emergencyBudgetRequestBody("GOODS"),
      isEmergency: false,
    });
    expect(res.status()).toBe(400);
  });

  test("BUD-B-05 mixing Goods and Non-Goods items in one emergency request is rejected (400)", async () => {
    const goods = emergencyBudgetRequestBody("GOODS");
    const nonGoods = emergencyBudgetRequestBody("NON_GOODS");
    const res = await principal.post("/api/college/budget-requests", {
      ...goods,
      recurring: nonGoods.recurring,
    });
    expect(res.status()).toBe(400);
  });

  test("BUD-B-01 Principal raises a Goods emergency request; server derives emergencyType", async () => {
    const res = await principal.post("/api/college/budget-requests", emergencyBudgetRequestBody("GOODS"));
    expect(res.status()).toBe(201);
    const { id } = await res.json();

    const detail = await principal.get(`/api/college/budget-requests/${id}`);
    const { request: req } = await detail.json();
    expect(req.status).toBe("PENDING_MANAGEMENT_APPROVAL");
    expect(req.isEmergency).toBe(true);
    expect(req.emergencyType).toBe("GOODS");
  });

  test("BUD-B-07 / B-11 Management approves, converges at L1_FROZEN, Finance approves (Goods) creates clearance", async () => {
    const createRes = await principal.post("/api/college/budget-requests", emergencyBudgetRequestBody("GOODS"));
    const { id } = await createRes.json();

    const mgmtApprove = await management.patch(`/api/management/emergency-budget-requests/${id}`, {
      collegeId: testUsers.principal.collegeId,
      action: "APPROVE",
    });
    expect(mgmtApprove.ok()).toBeTruthy();
    const frozen = await (await principal.get(`/api/college/budget-requests/${id}`)).json();
    expect(frozen.request.status).toBe("L1_FROZEN");

    const financeApprove = await finance.patch(`/api/college/budget-requests/${id}`, {
      action: "APPROVE",
      fiscalYear: "2026-27",
    });
    expect(financeApprove.ok()).toBeTruthy();
    const { purchaseClearanceId } = await financeApprove.json();
    expect(purchaseClearanceId).toBeTruthy(); // Goods emergency -> clearance IS created
  });

  test("BUD-B-12 Finance approves a Non-Goods emergency request: no Purchase Clearance is created", async () => {
    const createRes = await principal.post("/api/college/budget-requests", emergencyBudgetRequestBody("NON_GOODS"));
    const { id } = await createRes.json();
    await management.patch(`/api/management/emergency-budget-requests/${id}`, {
      collegeId: testUsers.principal.collegeId,
      action: "APPROVE",
    });

    const financeApprove = await finance.patch(`/api/college/budget-requests/${id}`, {
      action: "APPROVE",
      fiscalYear: "2026-27",
    });
    expect(financeApprove.ok()).toBeTruthy();
    const { purchaseClearanceId } = await financeApprove.json();
    expect(purchaseClearanceId).toBeUndefined();

    const approved = await (await principal.get(`/api/college/budget-requests/${id}`)).json();
    expect(approved.request.status).toBe("FINANCE_APPROVED");
  });

  test("BUD-B-13 Finance RETURN on an emergency request goes to RETURNED_TO_PRINCIPAL (not RETURNED_TO_HOD)", async () => {
    const createRes = await principal.post("/api/college/budget-requests", emergencyBudgetRequestBody("GOODS"));
    const { id } = await createRes.json();
    await management.patch(`/api/management/emergency-budget-requests/${id}`, {
      collegeId: testUsers.principal.collegeId,
      action: "APPROVE",
    });

    const ret = await finance.patch(`/api/college/budget-requests/${id}`, {
      action: "RETURN",
      remarks: "Playwright: clarify emergency reason",
    });
    expect(ret.ok()).toBeTruthy();
    const returned = await (await principal.get(`/api/college/budget-requests/${id}`)).json();
    expect(returned.request.status).toBe("RETURNED_TO_PRINCIPAL");
  });

  test("BUD-B-14 / B-15 report upload only valid for FINANCE_APPROVED Non-Goods requests", async () => {
    // Goods request, even once approved, must reject the report-upload branch (falls through to 409)
    const goodsRes = await principal.post("/api/college/budget-requests", emergencyBudgetRequestBody("GOODS"));
    const { id: goodsId } = await goodsRes.json();
    await management.patch(`/api/management/emergency-budget-requests/${goodsId}`, {
      collegeId: testUsers.principal.collegeId,
      action: "APPROVE",
    });
    await finance.patch(`/api/college/budget-requests/${goodsId}`, { action: "APPROVE", fiscalYear: "2026-27" });
    const badReport = await finance.patch(`/api/college/budget-requests/${goodsId}`, {
      reportFileUrl: "https://example.invalid/report.pdf",
      reportFileName: "report.pdf",
    });
    expect(badReport.status()).toBe(409);

    // Non-Goods, FINANCE_APPROVED -> report upload succeeds
    const nonGoodsRes = await principal.post("/api/college/budget-requests", emergencyBudgetRequestBody("NON_GOODS"));
    const { id: nonGoodsId } = await nonGoodsRes.json();
    await management.patch(`/api/management/emergency-budget-requests/${nonGoodsId}`, {
      collegeId: testUsers.principal.collegeId,
      action: "APPROVE",
    });
    await finance.patch(`/api/college/budget-requests/${nonGoodsId}`, { action: "APPROVE", fiscalYear: "2026-27" });
    const goodReport = await finance.patch(`/api/college/budget-requests/${nonGoodsId}`, {
      reportFileUrl: "https://example.invalid/report.pdf",
      reportFileName: "report.pdf",
    });
    expect(goodReport.ok()).toBeTruthy();
    const withReport = await (await principal.get(`/api/college/budget-requests/${nonGoodsId}`)).json();
    expect(withReport.request.reportFileUrl).toBeTruthy();
    expect(withReport.request.status).toBe("FINANCE_APPROVED"); // no status change from report upload
  });

  test("BUD-B-08 Management reject/return without remarks is rejected (400)", async () => {
    const createRes = await principal.post("/api/college/budget-requests", emergencyBudgetRequestBody("GOODS"));
    const { id } = await createRes.json();

    const reject = await management.patch(`/api/management/emergency-budget-requests/${id}`, {
      collegeId: testUsers.principal.collegeId,
      action: "REJECT",
    });
    expect(reject.status()).toBe(400);
  });
});
