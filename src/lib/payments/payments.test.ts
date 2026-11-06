import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";

vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => ({}) }));

import { ccavDecrypt, ccavEncrypt, ccavName, ccavParseResponse, ccavRequestString, ccavAmount, ccavUrlOk, sameAmount } from "./ccavenue";
import { decideSettlement, settlePayment } from "./settle";
import { openSecret, sealSecret } from "./secretBox";

const KEY = "ABCDEF0123456789ABCDEF0123456789";
const C = "colleges/c1";
const resp = (over: Record<string, string> = {}) => ccavParseResponse(new URLSearchParams({
  order_id: "FMS1", tracking_id: "3100", bank_ref_no: "BR9", order_status: "Success", amount: "150.00", currency: "INR",
  payment_mode: "UPI", merchant_param1: "c1", ...over,
}).toString());

describe("CCAvenue request / response format", () => {
  it("encrypts and decrypts (AES-128-CBC, MD5 key, fixed IV) as hex", () => {
    const plain = "merchant_id=1&order_id=FMS1&amount=150.00";
    const enc = ccavEncrypt(plain, KEY);
    expect(enc).toMatch(/^[0-9a-f]+$/);
    expect(enc.length % 32).toBe(0);
    expect(ccavDecrypt(enc, KEY)).toBe(plain);
    // Same input, same key -> same output (CCAvenue's kit has no random IV).
    expect(ccavEncrypt(plain, KEY)).toBe(enc);
  });

  it("refuses a response made with another key or tampered", () => {
    const enc = ccavEncrypt("order_id=FMS1&order_status=Success", KEY);
    expect(() => ccavDecrypt(enc, "ZZZZZZ0123456789ABCDEF0123456789")).toThrow();
    expect(() => ccavDecrypt("nothex!", KEY)).toThrow();
  });

  it("builds the order with the amount in rupees and paise", () => {
    const s = new URLSearchParams(ccavRequestString({ merchantId: "12", orderId: "FMS1", amount: 150, redirectUrl: "https://x/r", cancelUrl: "https://x/r", billingTel: "+91 98765-43210", merchantParam1: "c1" }));
    expect(s.get("amount")).toBe("150.00");
    expect(s.get("currency")).toBe("INR");
    expect(s.get("billing_tel")).toBe("9876543210");
    expect(s.get("merchant_param1")).toBe("c1");
    expect(ccavAmount(99.999)).toBe("100.00");
  });

  it("follows CCAvenue's field rules (Integration Document 4.8)", () => {
    expect(ccavName("K. Venkata Rao")).toBe("K Venkata Rao");
    expect(ccavName("  Sri-Lakshmi  O'Neil ")).toBe("Sri Lakshmi O Neil");
    const ok = new URLSearchParams(ccavRequestString({ merchantId: "1", orderId: "FMS1", amount: 1, redirectUrl: "https://x/a", cancelUrl: "https://x/a", billingEmail: "a.b_c@vit.edu.in" }));
    expect(ok.get("billing_email")).toBe("a.b_c@vit.edu.in");
    const bad = new URLSearchParams(ccavRequestString({ merchantId: "1", orderId: "FMS1", amount: 1, redirectUrl: "https://x/a", cancelUrl: "https://x/a", billingEmail: "a-b+c@vit.edu.in" }));
    expect(bad.has("billing_email")).toBe(false);
    expect(ccavUrlOk("https://www.vishnupeople.in/api/public/ccavenue_response/fffeab8b168a4b449dea")).toBe(true);
    expect(ccavUrlOk("https://www.vishnupeople.in/api/public/ccavenue-response/x")).toBe(false);
  });

  it("reads the result: only Success is paid, Aborted is cancelled", () => {
    expect(resp().outcome).toBe("SUCCESS");
    expect(resp({ order_status: "Aborted" }).outcome).toBe("ABORTED");
    expect(resp({ order_status: "Failure" }).outcome).toBe("FAILED");
    expect(resp({ order_status: "Invalid" }).outcome).toBe("FAILED");
    expect(sameAmount(150, 150.0)).toBe(true);
    expect(sameAmount(149.99, 150)).toBe(false);
  });
});

describe("decideSettlement", () => {
  const p = { id: "FMS1", status: "INITIATED" as const, amount: 150, collegeId: "c1" };
  const p1 = { ...p, amount: 1 };
  it("a matching Success settles it", () => expect(decideSettlement(p, resp())).toEqual({ kind: "SET", status: "SUCCESS" }));
  it("another order is ignored", () => expect(decideSettlement(p, resp({ order_id: "FMS2" })).kind).toBe("IGNORE"));
  it("CCAvenue's convenience fee: amount 24.60, mer_amount 1.00 for a Rs. 1 order -> paid", () => {
    expect(decideSettlement(p1, resp({ amount: "24.60", mer_amount: "1.00" }))).toEqual({ kind: "SET", status: "SUCCESS" });
    expect(decideSettlement(p1, resp({ amount: "24.60", mer_amount: "5.00" })).kind).toBe("SET");
    expect(decideSettlement(p1, resp({ amount: "24.60", mer_amount: "5.00" }))).toMatchObject({ status: "FAILED" });
  });
  it("a wrong amount is recorded as failed, never paid", () => {
    expect(decideSettlement(p, resp({ amount: "1.00" }))).toMatchObject({ kind: "SET", status: "FAILED" });
  });
  it("an answer for another college is never paid", () => {
    expect(decideSettlement(p, resp({ merchant_param1: "c2" }))).toMatchObject({ kind: "SET", status: "FAILED" });
  });
  it("a paid payment never changes again; a failed one can still become paid", () => {
    expect(decideSettlement({ ...p, status: "SUCCESS" }, resp({ order_status: "Failure" })).kind).toBe("IGNORE");
    expect(decideSettlement({ ...p, status: "FAILED" }, resp())).toEqual({ kind: "SET", status: "SUCCESS" });
    expect(decideSettlement({ ...p, status: "ABORTED" }, resp({ order_status: "Aborted" })).kind).toBe("IGNORE");
  });
});

describe("settlePayment", () => {
  let fake: FakeFirestore;
  const seedPayment = (id: string, requestId = "r1") => fake.seed(`${C}/payments/${id}`, {
    collegeId: "c1", purpose: { kind: "CERTIFICATE", requestId, label: "Bonafide" }, amount: 150, currency: "INR", status: "INITIATED",
    gateway: "CCAVENUE", studentId: "s1", studentUid: "u1", studentName: "A", studentRollNumber: "R1", createdAt: "2026-11-06T00:00:00Z", updatedAt: "2026-11-06T00:00:00Z",
  });
  beforeEach(() => {
    fake = new FakeFirestore();
    fake.seed(`${C}/certificateRequests/r1`, { status: "IN_PROGRESS", feeAmount: 150, requesterUid: "u1" });
  });

  it("marks the payment and the request's fee paid, once", async () => {
    seedPayment("FMS1");
    const db = asFirestore(fake);
    const first = await settlePayment(db, "c1", resp());
    expect(first).toMatchObject({ changed: true, newlyPaid: true });
    expect(fake.read(`${C}/payments/FMS1`)).toMatchObject({ status: "SUCCESS", trackingId: "3100", bankRefNo: "BR9" });
    expect(fake.read(`${C}/certificateRequests/r1`)!.feePaid).toMatchObject({ paymentId: "FMS1", trackingId: "3100", amount: 150 });
    const again = await settlePayment(db, "c1", resp());
    expect(again).toMatchObject({ changed: false, newlyPaid: false });
  });

  it("a failed answer leaves the fee unpaid", async () => {
    seedPayment("FMS1");
    await settlePayment(asFirestore(fake), "c1", resp({ order_status: "Failure" }));
    expect(fake.read(`${C}/payments/FMS1`)!.status).toBe("FAILED");
    expect(fake.read(`${C}/certificateRequests/r1`)!.feePaid).toBeUndefined();
  });

  it("paid twice: the second payment is kept and flagged for a refund", async () => {
    seedPayment("FMS1"); seedPayment("FMS2");
    const db = asFirestore(fake);
    await settlePayment(db, "c1", resp());
    const second = await settlePayment(db, "c1", resp({ order_id: "FMS2", tracking_id: "3200" }));
    expect(second).toMatchObject({ newlyPaid: false, alreadyPaidByOther: true });
    expect(fake.read(`${C}/payments/FMS2`)).toMatchObject({ status: "SUCCESS", needsRefund: true });
    expect(fake.read(`${C}/certificateRequests/r1`)!.feePaid).toMatchObject({ paymentId: "FMS1" });
  });

  it("an unknown order changes nothing", async () => {
    expect(await settlePayment(asFirestore(fake), "c1", resp({ order_id: "NOPE" }))).toBeNull();
  });
});

describe("secretBox", () => {
  it("seals and opens with PAYMENT_CONFIG_SECRET, and refuses without it", () => {
    const prev = process.env.PAYMENT_CONFIG_SECRET;
    process.env.PAYMENT_CONFIG_SECRET = "x".repeat(40);
    const sealed = sealSecret(KEY);
    expect(sealed).not.toContain(KEY);
    expect(openSecret(sealed)).toBe(KEY);
    expect(() => openSecret(sealed.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toThrow();
    process.env.PAYMENT_CONFIG_SECRET = "short";
    expect(() => sealSecret(KEY)).toThrow();
    if (prev === undefined) delete process.env.PAYMENT_CONFIG_SECRET; else process.env.PAYMENT_CONFIG_SECRET = prev;
  });
});
