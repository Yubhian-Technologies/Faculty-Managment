import { ccavDecrypt, ccavEncrypt, ccavAmount, type CcavOutcome, type CcavResponse } from "./ccavenue";
import { proxyPostForm } from "./proxyPost";

// CCAvenue's server-to-server API (order status, refund) - version 1.2, JSON in and out, each
// request encrypted like checkout. CCAvenue only accepts these calls from whitelisted IPs, so they
// always go through the static-IP proxy (proxyPostForm).

export const CCAVENUE_API_URL = {
  TEST: "https://apitest.ccavenue.com/apis/servlet/DoWebTrans",
  LIVE: "https://api.ccavenue.com/apis/servlet/DoWebTrans",
} as const;

export interface CcavApiAccount {
  env: "TEST" | "LIVE";
  accessCode: string;
  workingKey: string;
  /** More Access Code + Working Key pairs (one per whitelisted proxy IP), tried in turn when CCAvenue refuses one. */
  fallbacks?: { accessCode: string; workingKey: string }[];
}

/** CCAvenue refused the call itself (status 1: wrong access code for this IP, invalid parameter ...). */
export class CcavApiRefused extends Error {}

/** Reads CCAvenue's API answer ("status=0&enc_response=..."); status 1 = their error text in enc_response. */
export function readApiAnswer(body: string, workingKey: string): Record<string, unknown> {
  const p = new URLSearchParams(body.trim());
  const status = p.get("status");
  const enc = (p.get("enc_response") ?? "").trim();
  if (status !== "0") throw new CcavApiRefused(`CCAvenue refused the call: ${enc || body.slice(0, 200)}`);
  let plain: string;
  try { plain = ccavDecrypt(enc, workingKey); } catch { throw new CcavApiRefused("CCAvenue's answer doesn't open with this Working Key"); }
  return JSON.parse(plain) as Record<string, unknown>;
}

type Poster = (url: string, form: Record<string, string>) => Promise<{ status: number; body: string }>;

/**
 * One API call. The proxy may send it from any of its static IPs, and CCAvenue may have given each IP its own
 * Access Code + Working Key - so the website pair is tried first, then each extra pair, until CCAvenue accepts one.
 * A refused call changes nothing at CCAvenue, so trying the next pair is safe (a refund carries the same
 * refund_ref_no each time). A network error stops at once (unknown whether it reached CCAvenue).
 */
export async function callApi(acc: CcavApiAccount, command: string, data: Record<string, string>, post: Poster = proxyPostForm): Promise<Record<string, unknown>> {
  const pairs = [{ accessCode: acc.accessCode, workingKey: acc.workingKey }, ...(acc.fallbacks ?? [])];
  const refusals: string[] = [];
  for (const pair of pairs) {
    const res = await post(CCAVENUE_API_URL[acc.env], {
      enc_request: ccavEncrypt(JSON.stringify(data), pair.workingKey),
      access_code: pair.accessCode, command, request_type: "JSON", response_type: "JSON", version: "1.2",
    });
    if (res.status !== 200) throw new Error(`CCAvenue API answered HTTP ${res.status}`);
    try { return readApiAnswer(res.body, pair.workingKey); }
    catch (e) { if (e instanceof CcavApiRefused) { refusals.push(e.message); continue; } throw e; }
  }
  throw new CcavApiRefused(refusals.length > 1 ? `CCAvenue refused every API key (${refusals.length}): ${refusals[0]}` : refusals[0] ?? "CCAvenue refused the call");
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
    amount: Number(r.order_gross_amt ?? r.order_amt ?? NaN), merAmount: Number(r.order_amt ?? NaN), currency: str(r.order_currncy || r.order_currency), paymentMode: str(r.order_option_type),
    cardName: str(r.order_card_name), statusMessage: str(r.order_status_date_time), failureMessage: str(r.order_bank_response),
    merchantParam1: "", fields,
  };
}

export async function orderStatus(acc: CcavApiAccount, orderId: string): Promise<CcavResponse | null> {
  return statusAsResponse(orderId, await callApi(acc, "orderStatusTracker", { order_no: orderId }));
}

/** Asks CCAvenue to refund `amount` of a paid order (by its tracking id). `refundRef` is ours and unique per refund. */
export async function refundOrder(acc: CcavApiAccount, trackingId: string, amount: number, refundRef: string): Promise<{ ok: boolean; reason: string }> {
  const j = await callApi(acc, "refundOrder", { reference_no: trackingId, refund_amount: ccavAmount(amount), refund_ref_no: refundRef });
  const r = (j.Refund_Order_Result ?? j) as Record<string, unknown>;
  return { ok: str(r.refund_status) === "0", reason: str(r.reason) || str(r.error_desc) };
}
