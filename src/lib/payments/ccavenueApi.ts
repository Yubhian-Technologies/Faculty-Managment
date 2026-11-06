import { ccavDecrypt, ccavEncrypt, ccavAmount, type CcavOutcome, type CcavResponse } from "./ccavenue";
import { proxyPostForm } from "./proxyPost";

// CCAvenue's server-to-server API (order status, refund) - version 1.2, JSON in and out, each
// request encrypted like checkout. CCAvenue only accepts these calls from whitelisted IPs, so they
// always go through the static-IP proxy (proxyPostForm).

export const CCAVENUE_API_URL = {
  TEST: "https://apitest.ccavenue.com/apis/servlet/DoWebTrans",
  LIVE: "https://api.ccavenue.com/apis/servlet/DoWebTrans",
} as const;

export interface CcavApiAccount { env: "TEST" | "LIVE"; accessCode: string; workingKey: string }

/** Reads CCAvenue's API answer ("status=0&enc_response=..."); status 1 = their error text in enc_response. */
export function readApiAnswer(body: string, workingKey: string): Record<string, unknown> {
  const p = new URLSearchParams(body.trim());
  const status = p.get("status");
  const enc = (p.get("enc_response") ?? "").trim();
  if (status !== "0") throw new Error(`CCAvenue refused the call: ${enc || body.slice(0, 200)}`);
  const json = JSON.parse(ccavDecrypt(enc, workingKey)) as Record<string, unknown>;
  return json;
}

async function call(acc: CcavApiAccount, command: string, data: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await proxyPostForm(CCAVENUE_API_URL[acc.env], {
    enc_request: ccavEncrypt(JSON.stringify(data), acc.workingKey),
    access_code: acc.accessCode, command, request_type: "JSON", response_type: "JSON", version: "1.2",
  });
  if (res.status !== 200) throw new Error(`CCAvenue API answered HTTP ${res.status}`);
  return readApiAnswer(res.body, acc.workingKey);
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/** CCAvenue's order status words -> ours; null = still in progress (Initiated / Awaited) - change nothing. */
export function statusOutcome(orderStatus: string): CcavOutcome | null {
  const s = orderStatus.trim().toLowerCase();
  if (["successful", "success", "shipped", "refunded", "partially refunded", "chargeback"].includes(s)) return "SUCCESS";
  if (["aborted", "auto-cancelled", "auto cancelled", "cancelled", "auto-reversed"].includes(s)) return "ABORTED";
  if (["unsuccessful", "failure", "invalid", "timeout", "fraud", "system refund"].includes(s)) return "FAILED";
  return null;
}

/** An order status answer as a checkout response, so the same `settlePayment` records it. */
export function statusAsResponse(orderId: string, j: Record<string, unknown>): CcavResponse | null {
  // Some accounts wrap it: { Order_Status_Result: {...} }
  const r = (j.Order_Status_Result ?? j) as Record<string, unknown>;
  if (str(r.status) === "1") throw new Error(`CCAvenue: ${str(r.error_desc) || "order not found"}`);
  const orderStatus = str(r.order_status);
  const outcome = statusOutcome(orderStatus);
  if (!outcome) return null;
  const fields = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, str(v)]));
  return {
    orderId: str(r.order_no) || orderId, trackingId: str(r.reference_no), bankRefNo: str(r.order_bank_ref_no), orderStatus, outcome,
    amount: Number(r.order_amt ?? r.order_gross_amt ?? NaN), currency: str(r.order_currncy || r.order_currency), paymentMode: str(r.order_option_type),
    cardName: str(r.order_card_name), statusMessage: str(r.order_status_date_time), failureMessage: str(r.order_bank_response),
    merchantParam1: "", fields,
  };
}

export async function orderStatus(acc: CcavApiAccount, orderId: string): Promise<CcavResponse | null> {
  return statusAsResponse(orderId, await call(acc, "orderStatusTracker", { order_no: orderId }));
}

/** Asks CCAvenue to refund `amount` of a paid order (by its tracking id). `refundRef` is ours and unique per refund. */
export async function refundOrder(acc: CcavApiAccount, trackingId: string, amount: number, refundRef: string): Promise<{ ok: boolean; reason: string }> {
  const j = await call(acc, "refundOrder", { reference_no: trackingId, refund_amount: ccavAmount(amount), refund_ref_no: refundRef });
  const r = (j.Refund_Order_Result ?? j) as Record<string, unknown>;
  return { ok: str(r.refund_status) === "0", reason: str(r.reason) || str(r.error_desc) };
}
