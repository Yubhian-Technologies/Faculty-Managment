// Flow C — Indent Request (Goods): HOD -> Purchase Dept -> Finance -> Purchase Dept.
// Cases reference the IDs in the published QA test plan (IND-G-*).

import { test, expect } from "@playwright/test";
import { ApiClient } from "../support/apiClient";
import { testUsers } from "../support/testUsers";
import { goodsIndentBody, quotation, threeQuotations } from "../support/builders";

test.describe("Flow C — Indent Request (Goods)", () => {
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

  test("IND-G-01 HOD raises a Goods indent -> PENDING_PURCHASE_REVIEW", async () => {
    const res = await hod.post("/api/college/indent-requests", goodsIndentBody());
    expect(res.status()).toBe(201);
    const { id } = await res.json();
    const detail = await (await hod.get(`/api/college/indent-requests/${id}`)).json();
    expect(detail.request.status).toBe("PENDING_PURCHASE_REVIEW");
  });

  test("IND-G-02 item with quantity <= 0 is rejected (400)", async () => {
    const res = await hod.post(
      "/api/college/indent-requests",
      goodsIndentBody({ items: [{ id: "x", description: "bad", quantity: 0, estimatedUnitPrice: 10 }] })
    );
    expect(res.status()).toBe(400);
  });

  test("IND-G-03 Send to Finance with only 2 quotations is rejected (400)", async () => {
    const createRes = await hod.post("/api/college/indent-requests", goodsIndentBody());
    const { id } = await createRes.json();
    const twoQuotes = [quotation("Vendor A", 100), quotation("Vendor B", 110)];
    const res = await purchase.patch(`/api/college/indent-requests/${id}`, {
      action: "SEND_TO_FINANCE",
      quotations: twoQuotes,
      selectedQuotationId: twoQuotes[0].id,
    });
    expect(res.status()).toBe(400);
  });

  test("IND-G-04 Send to Finance with 3 quotations but none selected is rejected (400)", async () => {
    const createRes = await hod.post("/api/college/indent-requests", goodsIndentBody());
    const { id } = await createRes.json();
    const res = await purchase.patch(`/api/college/indent-requests/${id}`, {
      action: "SEND_TO_FINANCE",
      quotations: threeQuotations(),
    });
    expect(res.status()).toBe(400);
  });

  test("IND-G-05 through IND-G-11 full happy path: quote -> approve -> receipt", async () => {
    const createRes = await hod.post("/api/college/indent-requests", goodsIndentBody());
    const { id } = await createRes.json();

    const quotes = threeQuotations();
    const sendToFinance = await purchase.patch(`/api/college/indent-requests/${id}`, {
      action: "SEND_TO_FINANCE",
      quotations: quotes,
      selectedQuotationId: quotes[1].id, // cheapest, Vendor B
    });
    expect(sendToFinance.ok()).toBeTruthy();
    const forwarded = await (await hod.get(`/api/college/indent-requests/${id}`)).json();
    expect(forwarded.request.status).toBe("PENDING_FINANCE_REVIEW");

    const approve = await finance.patch(`/api/college/indent-requests/${id}`, { action: "APPROVE" });
    expect(approve.ok()).toBeTruthy();
    const { financePaymentId } = await approve.json();
    expect(financePaymentId).toBeTruthy();
    const approved = await (await hod.get(`/api/college/indent-requests/${id}`)).json();
    expect(approved.request.status).toBe("APPROVED"); // not COMPLETED yet

    const receipt = await purchase.patch(`/api/college/indent-requests/${id}`, {
      action: "UPLOAD_RECEIPT",
      receiptUrl: "https://example.invalid/receipt.pdf",
      receiptFileName: "receipt.pdf",
      receiptAmount: 2500,
    });
    expect(receipt.ok()).toBeTruthy();
    const completed = await (await hod.get(`/api/college/indent-requests/${id}`)).json();
    expect(completed.request.status).toBe("COMPLETED");
  });

  test("IND-G-09 Finance RETURN sends it back to Purchase Dept, which can re-quote and resend", async () => {
    const createRes = await hod.post("/api/college/indent-requests", goodsIndentBody());
    const { id } = await createRes.json();
    const quotes = threeQuotations();
    await purchase.patch(`/api/college/indent-requests/${id}`, {
      action: "SEND_TO_FINANCE",
      quotations: quotes,
      selectedQuotationId: quotes[0].id,
    });

    const ret = await finance.patch(`/api/college/indent-requests/${id}`, {
      action: "RETURN",
      remarks: "Playwright: get one more competitive quote",
    });
    expect(ret.ok()).toBeTruthy();
    const returned = await (await hod.get(`/api/college/indent-requests/${id}`)).json();
    expect(returned.request.status).toBe("RETURNED_TO_PURCHASE");

    const newQuotes = threeQuotations();
    const resend = await purchase.patch(`/api/college/indent-requests/${id}`, {
      action: "SEND_TO_FINANCE",
      quotations: newQuotes,
      selectedQuotationId: newQuotes[0].id,
    });
    expect(resend.ok()).toBeTruthy();
  });

  test("IND-G-10 Finance REJECT is terminal, no payment created", async () => {
    const createRes = await hod.post("/api/college/indent-requests", goodsIndentBody());
    const { id } = await createRes.json();
    const quotes = threeQuotations();
    await purchase.patch(`/api/college/indent-requests/${id}`, {
      action: "SEND_TO_FINANCE",
      quotations: quotes,
      selectedQuotationId: quotes[0].id,
    });

    const reject = await finance.patch(`/api/college/indent-requests/${id}`, {
      action: "REJECT",
      remarks: "Playwright: budget exhausted for this line",
    });
    expect(reject.ok()).toBeTruthy();
    const { financePaymentId } = await reject.json();
    expect(financePaymentId).toBeUndefined();
    const rejected = await (await hod.get(`/api/college/indent-requests/${id}`)).json();
    expect(rejected.request.status).toBe("REJECTED");
  });

  test("IND-G-12 receipt upload without receiptUrl is rejected (400)", async () => {
    const createRes = await hod.post("/api/college/indent-requests", goodsIndentBody());
    const { id } = await createRes.json();
    const quotes = threeQuotations();
    await purchase.patch(`/api/college/indent-requests/${id}`, {
      action: "SEND_TO_FINANCE",
      quotations: quotes,
      selectedQuotationId: quotes[0].id,
    });
    await finance.patch(`/api/college/indent-requests/${id}`, { action: "APPROVE" });

    const res = await purchase.patch(`/api/college/indent-requests/${id}`, { action: "UPLOAD_RECEIPT" });
    expect(res.status()).toBe(400);
  });

  test("IND-G-13 receipt upload before Finance approval is rejected (409)", async () => {
    const createRes = await hod.post("/api/college/indent-requests", goodsIndentBody());
    const { id } = await createRes.json();
    const quotes = threeQuotations();
    await purchase.patch(`/api/college/indent-requests/${id}`, {
      action: "SEND_TO_FINANCE",
      quotations: quotes,
      selectedQuotationId: quotes[0].id,
    });

    const res = await purchase.patch(`/api/college/indent-requests/${id}`, {
      action: "UPLOAD_RECEIPT",
      receiptUrl: "https://example.invalid/receipt.pdf",
    });
    expect(res.status()).toBe(409);
  });

  test("IND-G-14 HOD resubmit of a returned Goods indent loops back to Purchase Dept, not Finance", async () => {
    const createRes = await hod.post("/api/college/indent-requests", goodsIndentBody());
    const { id } = await createRes.json();
    await purchase.patch(`/api/college/indent-requests/${id}`, {
      action: "RETURN",
      remarks: "Playwright: add more item detail",
    });

    const resubmit = await hod.patch(`/api/college/indent-requests/${id}`, {
      items: [{ id: "item-1", description: "Updated (Playwright)", quantity: 5, estimatedUnitPrice: 300 }],
    });
    expect(resubmit.ok()).toBeTruthy();
    const detail = await (await hod.get(`/api/college/indent-requests/${id}`)).json();
    expect(detail.request.status).toBe("PENDING_PURCHASE_REVIEW");
  });
});
