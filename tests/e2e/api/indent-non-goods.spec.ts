// Flow D — Indent Request (Non-Goods): HOD -> Finance direct, Purchase Dept never involved.
// Cases reference the IDs in the published QA test plan (IND-N-*).

import { test, expect } from "@playwright/test";
import { ApiClient } from "../support/apiClient";
import { testUsers } from "../support/testUsers";
import { nonGoodsIndentBody, indentItem } from "../support/builders";

test.describe("Flow D — Indent Request (Non-Goods)", () => {
  let hod: ApiClient;
  let purchase: ApiClient;
  let finance: ApiClient;

  test.beforeAll(async ({ baseURL }) => {
    hod = await ApiClient.as(baseURL!, testUsers.hod);
    purchase = await ApiClient.as(baseURL!, testUsers.purchaseDept);
    finance = await ApiClient.as(baseURL!, testUsers.finance);
  });

  test.afterAll(async () => {
    await Promise.all([hod?.dispose(), purchase?.dispose(), finance?.dispose()]);
  });

  test("IND-N-01 HOD raises a Non-Goods indent -> PENDING_FINANCE_REVIEW directly", async () => {
    const res = await hod.post("/api/college/indent-requests", nonGoodsIndentBody());
    expect(res.status()).toBe(201);
    const { id } = await res.json();
    const detail = await (await hod.get(`/api/college/indent-requests/${id}`)).json();
    expect(detail.request.status).toBe("PENDING_FINANCE_REVIEW");
    expect(detail.request.quotations).toEqual([]);
  });

  test("IND-N-02 Purchase Dept cannot act on a Non-Goods indent (409, never PENDING_PURCHASE_REVIEW)", async () => {
    const createRes = await hod.post("/api/college/indent-requests", nonGoodsIndentBody());
    const { id } = await createRes.json();
    const res = await purchase.patch(`/api/college/indent-requests/${id}`, {
      action: "RETURN",
      remarks: "Playwright: should never be reachable",
    });
    expect(res.status()).toBe(409);
  });

  test("IND-N-03 / N-07 Finance approve completes the indent in one hop with a STAFF_REIMBURSEMENT payment", async () => {
    const createRes = await hod.post(
      "/api/college/indent-requests",
      nonGoodsIndentBody({ items: [indentItem({ quantity: 4, estimatedUnitPrice: 500 })] })
    );
    const { id } = await createRes.json();

    const approve = await finance.patch(`/api/college/indent-requests/${id}`, { action: "APPROVE" });
    expect(approve.ok()).toBeTruthy();
    const { financePaymentId } = await approve.json();
    expect(financePaymentId).toBeTruthy();

    const completed = await (await hod.get(`/api/college/indent-requests/${id}`)).json();
    expect(completed.request.status).toBe("COMPLETED"); // no intermediate APPROVED state
  });

  test("IND-N-04 Finance REJECT is terminal, no payment created", async () => {
    const createRes = await hod.post("/api/college/indent-requests", nonGoodsIndentBody());
    const { id } = await createRes.json();

    const reject = await finance.patch(`/api/college/indent-requests/${id}`, {
      action: "REJECT",
      remarks: "Playwright: not a valid Non-Goods spend",
    });
    expect(reject.ok()).toBeTruthy();
    const { financePaymentId } = await reject.json();
    expect(financePaymentId).toBeUndefined();
    const rejected = await (await hod.get(`/api/college/indent-requests/${id}`)).json();
    expect(rejected.request.status).toBe("REJECTED");
  });

  test("IND-N-05 / N-06 Finance RETURN goes to RETURNED_TO_HOD; resubmit loops to PENDING_FINANCE_REVIEW again", async () => {
    const createRes = await hod.post("/api/college/indent-requests", nonGoodsIndentBody());
    const { id } = await createRes.json();

    const ret = await finance.patch(`/api/college/indent-requests/${id}`, {
      action: "RETURN",
      remarks: "Playwright: clarify honorarium recipient",
    });
    expect(ret.ok()).toBeTruthy();
    const returned = await (await hod.get(`/api/college/indent-requests/${id}`)).json();
    expect(returned.request.status).toBe("RETURNED_TO_HOD");

    const resubmit = await hod.patch(`/api/college/indent-requests/${id}`, {
      items: [indentItem({ description: "Clarified honorarium (Playwright)" })],
    });
    expect(resubmit.ok()).toBeTruthy();
    const resubmitted = await (await hod.get(`/api/college/indent-requests/${id}`)).json();
    expect(resubmitted.request.status).toBe("PENDING_FINANCE_REVIEW"); // straight back, skipping Purchase Dept
  });

  test("IND-N-08 server trusts an explicit NON_GOODS override on a Goods-leaning category", async () => {
    const res = await hod.post(
      "/api/college/indent-requests",
      nonGoodsIndentBody({ category: "Lab Equipment", requestType: "NON_GOODS" })
    );
    expect(res.status()).toBe(201);
    const { id } = await res.json();
    const detail = await (await hod.get(`/api/college/indent-requests/${id}`)).json();
    // Unlike emergency budget's server-derived emergencyType, requestType here is taken as submitted.
    expect(detail.request.requestType).toBe("NON_GOODS");
    expect(detail.request.status).toBe("PENDING_FINANCE_REVIEW");
  });
});
