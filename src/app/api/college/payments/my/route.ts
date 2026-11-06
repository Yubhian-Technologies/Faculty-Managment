export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { paymentProxyConfigured } from "@/lib/payments/proxyPost";
import { loadCcavenue, paymentErrorResponse, paymentOf, paymentRefs, paymentView } from "@/lib/payments/server";

// The student's own online payments, and whether their college takes online payment.
export async function GET() {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const [settings, snap] = await Promise.all([
      loadCcavenue(db, session.collegeId),
      paymentRefs(db, session.collegeId).payments.where("studentUid", "==", session.uid).get(),
    ]);
    const payments = snap.docs.map((d) => paymentView(paymentOf(d.id, d.data()))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const onlineEnabled = !!(settings?.enabled && settings.merchantId && settings.accessCode && settings.workingKeyEnc);
    return NextResponse.json({ onlineEnabled, canCheck: onlineEnabled && paymentProxyConfigured(), payments });
  } catch (err) {
    return paymentErrorResponse(err, "[college/payments/my GET]");
  }
}
