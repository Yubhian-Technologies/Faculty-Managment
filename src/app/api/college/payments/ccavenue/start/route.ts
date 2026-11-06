export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { CERTIFICATE_REQUESTS_COL } from "@/lib/certifications/transitions";
import { CCAVENUE_CHECKOUT_URL, ccavEncrypt, ccavRequestString } from "@/lib/payments/ccavenue";
import { activeCcavenue, appBaseUrl, PaymentError, paymentErrorResponse, paymentRefs } from "@/lib/payments/server";
import type { CertificateRequest, Payment } from "@/types";

// A student starts paying a fee online: { purpose: { kind: "CERTIFICATE", requestId } }.
// The amount is the request's own fee (never the browser's). A new order is written INITIATED, and
// the encrypted request is returned for the browser to post to CCAvenue's checkout page.

const PAYABLE: CertificateRequest["status"][] = ["IN_PROGRESS", "PENDING_ISSUANCE", "RETURNED"];

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const body = (await readJsonBody(request)) as { purpose?: { kind?: unknown; requestId?: unknown } };
    if (body.purpose?.kind !== "CERTIFICATE" || typeof body.purpose.requestId !== "string" || !body.purpose.requestId) throw new PaymentError("Unknown payment");
    const requestId = body.purpose.requestId;

    const account = await activeCcavenue(db, session.collegeId);
    if (!account) throw new PaymentError("Online payment isn't available for your college - pay at the College Office", 409);

    const reqSnap = await CERTIFICATE_REQUESTS_COL(db, session.collegeId).doc(requestId).get();
    const req = reqSnap.exists ? (reqSnap.data() as CertificateRequest) : null;
    if (!req || req.requesterUid !== session.uid) throw new PaymentError("Certificate request not found", 404);
    const amount = Number(req.feeAmount ?? 0);
    if (!(amount > 0)) throw new PaymentError("This certificate has no fee", 409);
    if (req.feePaid) throw new PaymentError("The fee is already paid", 409);
    if (req.feeReceiptNo) throw new PaymentError("The fee was already paid at the College Office", 409);
    if (!PAYABLE.includes(req.status)) throw new PaymentError("This request can't be paid for now", 409);

    // Order id: short, unique, letters + digits only (CCAvenue allows up to 30).
    const orderId = `FMS${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString("hex").toUpperCase()}`;
    const now = new Date().toISOString();
    const userSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const u = (userSnap.data() ?? {}) as { email?: string; mobileNo?: string; phone?: string };
    const payment: Omit<Payment, "id"> = {
      collegeId: session.collegeId,
      purpose: { kind: "CERTIFICATE", requestId, label: req.certificateTypeLabel },
      amount, currency: "INR", status: "INITIATED", gateway: "CCAVENUE",
      studentId: req.studentId, studentUid: session.uid, studentName: req.studentName, studentRollNumber: req.studentRollNumber,
      createdAt: now, updatedAt: now,
    };
    await paymentRefs(db, session.collegeId).payments.doc(orderId).create(payment);

    const back = `${appBaseUrl(request)}/api/public/ccavenue-response/${encodeURIComponent(session.collegeId)}`;
    const plain = ccavRequestString({
      merchantId: account.merchantId, orderId, amount, redirectUrl: back, cancelUrl: back,
      billingName: req.studentName, billingEmail: u.email ?? session.email, billingTel: u.mobileNo ?? u.phone,
      merchantParam1: session.collegeId, merchantParam2: requestId,
    });
    await writeAuditLogSafe(db, session.collegeId, {
      action: "PAYMENT_STARTED", performedBy: session.uid, performedByName: req.studentName, targetId: orderId,
      details: { amount, purpose: req.certificateTypeLabel, requestId },
    });
    return NextResponse.json({
      orderId,
      action: CCAVENUE_CHECKOUT_URL[account.env],
      fields: { encRequest: ccavEncrypt(plain, account.workingKey), access_code: account.accessCode },
    });
  } catch (err) {
    return paymentErrorResponse(err, "[college/payments/ccavenue/start POST]");
  }
}
