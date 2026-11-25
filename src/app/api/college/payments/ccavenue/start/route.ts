export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { CERTIFICATE_REQUESTS_COL } from "@/lib/certifications/transitions";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import { CCAVENUE_CHECKOUT_URL, ccavEncrypt, ccavRequestString, ccavUrlOk } from "@/lib/payments/ccavenue";
import { activeCcavenue, appBaseUrl, PaymentError, paymentErrorResponse, paymentRefs } from "@/lib/payments/server";
import { feeRefs } from "@/lib/fees/server";
import { onlineAmountError } from "@/lib/fees/online";
import { findOwnStudent } from "@/lib/students/ownContext";
import type { CertificateRequest, Payment, StudentFeeAccount } from "@/types";

// A student starts paying online:
//   { purpose: { kind: "CERTIFICATE", requestId } }        the request's own fee
//   { purpose: { kind: "FEE", accountId, amount } }        towards their own fee account (lib/fees/online.ts): at least
//                                                           the instalment due now, at most the balance
// The amount is always checked on the server (never the browser's alone). A new order is written INITIATED, and
// the encrypted request is returned for the browser to post to CCAvenue's checkout page.

const PAYABLE: CertificateRequest["status"][] = ["IN_PROGRESS", "PENDING_ISSUANCE", "RETURNED"];

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const body = (await readJsonBody(request)) as { purpose?: { kind?: unknown; requestId?: unknown; accountId?: unknown; amount?: unknown } };
    if (body.purpose?.kind === "FEE") return await startFee(request, session, body.purpose);
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

    const back = `${appBaseUrl(request)}/api/public/ccavenue_response/${encodeURIComponent(session.collegeId)}`;
    if (!ccavUrlOk(back)) {
      console.error("[college/payments/ccavenue/start] return URL not accepted by CCAvenue:", back);
      throw new PaymentError("Online payment isn't set up correctly (return address) - pay at the College Office and tell the Accounts office", 409);
    }
    // Order id: short, unique, letters + digits only (CCAvenue allows up to 30).
    const orderId = `FMS${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString("hex").toUpperCase()}`;
    const now = new Date().toISOString();
    let academicYear = "";
    try { academicYear = await resolveCollegeAcademicYear(db, session.collegeId); } catch { /* left out */ }
    const userSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const u = (userSnap.data() ?? {}) as { email?: string; mobileNo?: string; phone?: string };
    const payment: Omit<Payment, "id"> = {
      collegeId: session.collegeId,
      purpose: { kind: "CERTIFICATE", requestId, label: req.certificateTypeLabel },
      amount, currency: "INR", status: "INITIATED", gateway: "CCAVENUE",
      studentId: req.studentId, studentUid: session.uid, studentName: req.studentName, studentRollNumber: req.studentRollNumber,
      ...(req.studentYear ? { studentYear: req.studentYear } : {}), ...(req.studentDepartment ? { studentDepartment: req.studentDepartment } : {}),
      ...(academicYear ? { academicYear } : {}),
      createdAt: now, updatedAt: now,
    };
    await paymentRefs(db, session.collegeId).payments.doc(orderId).create(payment);

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

/** Student fees: an online payment towards the signed-in student's own fee account. */
async function startFee(request: Request, session: { uid: string; collegeId: string; email: string }, purpose: { accountId?: unknown; amount?: unknown }) {
  const db = getAdminDb();
  const account = await activeCcavenue(db, session.collegeId);
  if (!account) throw new PaymentError("Online payment isn't available for your college - pay at the college accounts counter", 409);
  const accountId = typeof purpose.accountId === "string" ? purpose.accountId : "";
  const fee = accountId ? ((await feeRefs(db, session.collegeId).accounts.doc(accountId).get()).data() as StudentFeeAccount | undefined) : undefined;
  const own = await findOwnStudent(db, session.collegeId, session.uid);
  if (!fee || !own.ok || fee.studentId !== own.student.id) throw new PaymentError("Fee not found", 404);
  const amount = Number(purpose.amount);
  const bad = onlineAmountError(fee, amount);
  if (bad) throw new PaymentError(bad, 409);
  const back = `${appBaseUrl(request)}/api/public/ccavenue_response/${encodeURIComponent(session.collegeId)}`;
  if (!ccavUrlOk(back)) {
    console.error("[college/payments/ccavenue/start] return URL not accepted by CCAvenue:", back);
    throw new PaymentError("Online payment isn't set up correctly (return address) - pay at the college accounts counter", 409);
  }
  const orderId = `FMS${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString("hex").toUpperCase()}`;
  const now = new Date().toISOString();
  const label = `Fees ${fee.academicYear}`;
  const u = ((await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get()).data() ?? {}) as { email?: string; mobileNo?: string; phone?: string };
  const payment: Omit<Payment, "id"> = {
    collegeId: session.collegeId, purpose: { kind: "FEE", accountId: fee.id, academicYear: fee.academicYear, label },
    amount, currency: "INR", status: "INITIATED", gateway: "CCAVENUE",
    studentId: fee.studentId, studentUid: session.uid, studentName: fee.name, studentRollNumber: fee.rollNumber,
    ...(fee.year ? { studentYear: fee.year } : {}), ...(fee.department ? { studentDepartment: fee.department } : {}), academicYear: fee.academicYear,
    createdAt: now, updatedAt: now,
  };
  await paymentRefs(db, session.collegeId).payments.doc(orderId).create(payment);
  const plain = ccavRequestString({
    merchantId: account.merchantId, orderId, amount, redirectUrl: back, cancelUrl: back,
    billingName: fee.name, billingEmail: u.email ?? session.email, billingTel: u.mobileNo ?? u.phone,
    merchantParam1: session.collegeId, merchantParam2: fee.id,
  });
  await writeAuditLogSafe(db, session.collegeId, {
    action: "PAYMENT_STARTED", performedBy: session.uid, performedByName: fee.name, targetId: orderId,
    details: { amount, purpose: label, accountId: fee.id },
  });
  return NextResponse.json({
    orderId,
    action: CCAVENUE_CHECKOUT_URL[account.env],
    fields: { encRequest: ccavEncrypt(plain, account.workingKey), access_code: account.accessCode },
  });
}
