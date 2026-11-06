import { createCipheriv, createDecipheriv, createHash } from "crypto";

// CCAvenue's request / response format (their non-seamless kit): the order is a query string
// encrypted with AES-128-CBC - key = MD5 of the Working Key, IV = bytes 0..15 - as hex, posted to
// their checkout page with the Access Code. They post the result back to our redirect URL the same
// way (encResp). Pure functions - no Firestore, no network.

const IV = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
const keyOf = (workingKey: string) => createHash("md5").update(workingKey, "utf8").digest();

export function ccavEncrypt(plain: string, workingKey: string): string {
  const c = createCipheriv("aes-128-cbc", keyOf(workingKey), IV);
  return Buffer.concat([c.update(plain, "utf8"), c.final()]).toString("hex");
}

export function ccavDecrypt(hex: string, workingKey: string): string {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 32 !== 0) throw new Error("BAD_CIPHERTEXT");
  const d = createDecipheriv("aes-128-cbc", keyOf(workingKey), IV);
  return Buffer.concat([d.update(Buffer.from(hex, "hex")), d.final()]).toString("utf8");
}

export const CCAVENUE_CHECKOUT_URL = {
  TEST: "https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction",
  LIVE: "https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction",
} as const;

/** Rupees with two decimals, as CCAvenue expects ("150.00"). */
export const ccavAmount = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export interface CcavOrder {
  merchantId: string;
  orderId: string;
  amount: number;
  redirectUrl: string;
  cancelUrl: string;
  billingName?: string;
  billingEmail?: string;
  billingTel?: string;
  /** Echoed back by CCAvenue - we put the college id here to double-check the response. */
  merchantParam1?: string;
  merchantParam2?: string;
}

/** A name as CCAvenue accepts it: letters and single spaces, at most 60. */
export const ccavName = (n?: string) => (n ?? "").normalize("NFKD").replace(/[^A-Za-z ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

/** redirect_url / cancel_url may only hold letters, numbers, / _ ? (and the scheme / host): no hyphens in the path. */
export const ccavUrlOk = (u: string) => {
  try { const x = new URL(u); return /^[A-Za-z0-9/_?=&]*$/.test(x.pathname + x.search) && u.length <= 100; } catch { return false; }
};

/** The plain request string (encrypt it with `ccavEncrypt`). */
export function ccavRequestString(o: CcavOrder): string {
  const p = new URLSearchParams({
    merchant_id: o.merchantId,
    order_id: o.orderId,
    currency: "INR",
    amount: ccavAmount(o.amount),
    redirect_url: o.redirectUrl,
    cancel_url: o.cancelUrl,
    language: "EN",
  });
  // CCAvenue's field rules (Integration Document 4.8): a name is letters + spaces only; an email only letters,
  // numbers, @ . _ (one with other characters is left out rather than refused); a phone digits only.
  const name = ccavName(o.billingName);
  if (name) p.set("billing_name", name);
  const email = (o.billingEmail ?? "").trim();
  if (email && email.length <= 70 && /^[A-Za-z0-9._]+@[A-Za-z0-9._]+$/.test(email)) p.set("billing_email", email);
  if (o.billingTel) p.set("billing_tel", o.billingTel.replace(/\D/g, "").slice(-10));
  if (o.merchantParam1) p.set("merchant_param1", o.merchantParam1);
  if (o.merchantParam2) p.set("merchant_param2", o.merchantParam2);
  return p.toString();
}

export type CcavOutcome = "SUCCESS" | "FAILED" | "ABORTED";

export interface CcavResponse {
  orderId: string;
  trackingId: string;
  bankRefNo: string;
  orderStatus: string;
  outcome: CcavOutcome;
  amount: number;
  currency: string;
  paymentMode: string;
  cardName: string;
  statusMessage: string;
  failureMessage: string;
  merchantParam1: string;
  fields: Record<string, string>;
}

/** Reads a decrypted response string. Only "Success" is a payment; "Aborted" = the student cancelled. */
export function ccavParseResponse(plain: string): CcavResponse {
  const fields: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(plain)) fields[k] = v;
  const status = (fields.order_status ?? "").trim();
  const outcome: CcavOutcome = status.toLowerCase() === "success" ? "SUCCESS" : status.toLowerCase() === "aborted" ? "ABORTED" : "FAILED";
  return {
    orderId: fields.order_id ?? "",
    trackingId: fields.tracking_id ?? "",
    bankRefNo: fields.bank_ref_no ?? "",
    orderStatus: status,
    outcome,
    amount: Number(fields.amount ?? NaN),
    currency: fields.currency ?? "",
    paymentMode: fields.payment_mode ?? "",
    cardName: fields.card_name ?? "",
    statusMessage: fields.status_message ?? "",
    failureMessage: fields.failure_message ?? "",
    merchantParam1: fields.merchant_param1 ?? "",
    fields,
  };
}

/** True when the amount CCAvenue reports is the amount we asked for (to the paisa). */
export const sameAmount = (a: number, b: number) => Number.isFinite(a) && Math.round(a * 100) === Math.round(b * 100);
