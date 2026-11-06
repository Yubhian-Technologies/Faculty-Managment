export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { paymentProxyConfigured } from "@/lib/payments/proxyPost";
import { paymentOf } from "@/lib/payments/server";
import { checkPaymentStatus } from "@/lib/payments/statusCheck";

// Every 15 minutes (functions/src/index.ts paymentStatusSweep, Bearer CRON_SECRET): asks CCAvenue
// about payments left INITIATED for 15 minutes to 3 days (the student closed the browser before
// coming back) and records the answer. Needs the static-IP proxy; without it, does nothing.
const MIN_AGE_MS = 15 * 60_000;
const MAX_AGE_MS = 3 * 24 * 3600_000;
const MAX_PER_RUN = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (auth.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= auth.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!paymentProxyConfigured()) return NextResponse.json({ skipped: "PAYMENT_PROXY_URL not set" });
  try {
    const db = getAdminDb();
    const now = Date.now();
    // Each college's own settings doc (a handful of colleges - no collection-group index needed).
    const colleges = await db.collection("colleges").select().get();
    const settings = colleges.empty ? [] : await db.getAll(...colleges.docs.map((c) => c.ref.collection("paymentSettings").doc("ccavenue")));
    let checked = 0, changed = 0, failed = 0;
    for (const s of settings) {
      if (!s.exists || (s.data() as { enabled?: boolean }).enabled !== true) continue;
      const collegeId = s.ref.parent.parent?.id;
      if (!collegeId) continue;
      const open = await db.collection("colleges").doc(collegeId).collection("payments").where("status", "==", "INITIATED").get();
      for (const d of open.docs) {
        if (checked >= MAX_PER_RUN) break;
        const p = paymentOf(d.id, d.data());
        const age = now - new Date(p.createdAt).getTime();
        if (age < MIN_AGE_MS || age > MAX_AGE_MS) continue;
        checked++;
        try { if ((await checkPaymentStatus(db, collegeId, p.id, { uid: "system", name: "Payment status sweep" })).changed) changed++; }
        catch (e) { failed++; console.warn("[cron/payment-status]", collegeId, p.id, e instanceof Error ? e.message : e); }
      }
    }
    return NextResponse.json({ checked, changed, failed });
  } catch (err) {
    console.error("[cron/payment-status POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
