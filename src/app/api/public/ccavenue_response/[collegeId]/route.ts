export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { notify } from "@/lib/notify";
import { ccavDecrypt, ccavParseResponse } from "@/lib/payments/ccavenue";
import { activeCcavenue, appBaseUrl } from "@/lib/payments/server";
import { settlePayment } from "@/lib/payments/settle";

// CCAvenue posts the payment result here (redirect + cancel URL; form field `encResp`), then the
// student's browser is sent on to their result page. Public on purpose (it is CCAvenue's browser
// post) - what makes it trustworthy is that `encResp` decrypts with this college's Working Key and
// names an order we created, for the amount we asked (`settlePayment`). Anything else changes nothing.

type Params = { params: Promise<{ collegeId: string }> };

export async function POST(request: Request, { params }: Params) {
  const base = appBaseUrl(request);
  const go = (path: string) => NextResponse.redirect(`${base}${path}`, 303);
  try {
    const { collegeId } = await params;
    const form = await request.formData();
    const encResp = String(form.get("encResp") ?? "");
    const db = getAdminDb();
    const account = await activeCcavenue(db, collegeId);
    if (!account || !encResp) return go("/student/payments?result=unknown");

    let plain: string;
    try { plain = ccavDecrypt(encResp, account.workingKey); }
    catch { console.warn("[public/ccavenue-response] undecryptable response for", collegeId); return go("/student/payments?result=unknown"); }
    const r = ccavParseResponse(plain);
    if (!r.orderId) return go("/student/payments?result=unknown");

    const settled = await settlePayment(db, collegeId, r);
    if (!settled) return go("/student/payments?result=unknown");
    const p = settled.payment;
    if (settled.changed) {
      await writeAuditLogSafe(db, collegeId, {
        action: `PAYMENT_${p.status}`, performedBy: p.studentUid, performedByName: p.studentName, targetId: p.id,
        details: { amount: p.amount, trackingId: p.trackingId ?? "", bankRefNo: p.bankRefNo ?? "", purpose: p.purpose.label, gatewayStatus: r.orderStatus, ...(p.failureMessage ? { note: p.failureMessage } : {}) },
      });
      if (settled.newlyPaid) {
        await notify(db, collegeId, p.studentUid, "PAYMENT_RECEIVED", "Payment received",
          `Rs. ${p.amount} paid for ${p.purpose.label} (CCAvenue ref ${p.trackingId}).`, `/student/payments/${encodeURIComponent(p.id)}`);
      }
      // Paid twice: the payment carries `needsRefund` - Accounts sees it flagged on their Payments page.
    }
    return go(`/student/payments/${encodeURIComponent(p.id)}`);
  } catch (err) {
    console.error("[public/ccavenue-response POST]", err);
    return go("/student/payments?result=unknown");
  }
}
