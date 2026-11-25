export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminStorage } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { notifyRole } from "@/lib/notify";
import { paymentErrorResponse } from "@/lib/payments/server";
import { actorName } from "@/lib/fees/http";
import { FeeError, feeRefs } from "@/lib/fees/server";
import { checkNewRequest, MAX_LETTER_BYTES } from "@/lib/fees/concessions";
import { ACADEMIC_YEAR_RE } from "@/lib/fees/rules";
import type { FeeConcessionRequest, StudentFeeAccount } from "@/types/fees";

// College Office > Fees > Concession Requests (own college).
// GET ?academicYear=&q=   q given: the students' fee accounts matching (Regd. No / name) to pick from; else the
//                          college's requests of that year, newest first.
// POST multipart { accountId, amount, headId?, reason, referralName, referralDetails?, letter (PDF <= 5 MB) }
//      -> a PENDING request for Management (told at once). One pending request per student at a time.

const OFFICE = ["COLLEGE_OFFICE"] as const;

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...OFFICE);
    const db = getAdminDb();
    const sp = new URL(request.url).searchParams;
    const academicYear = sp.get("academicYear") ?? "";
    if (!ACADEMIC_YEAR_RE.test(academicYear)) throw new FeeError("Select the academic year.");
    const refs = feeRefs(db, session.collegeId);
    const q = (sp.get("q") ?? "").trim().toUpperCase();
    if (q) {
      if (q.length < 2) throw new FeeError("Type at least 2 characters of the Regd. No or name.");
      const accounts = (await refs.accounts.where("academicYear", "==", academicYear).get()).docs.map((d) => d.data() as StudentFeeAccount)
        .filter((a) => a.rollNumber.toUpperCase().startsWith(q) || a.name.toUpperCase().includes(q)).slice(0, 30)
        .map((a) => ({ id: a.id, rollNumber: a.rollNumber, name: a.name, department: a.department, section: a.section, category: a.category, funding: a.funding, gross: a.gross, concessionTotal: a.concessionTotal, studentShare: a.studentShare, paid: a.paid, heads: a.heads.map((h) => ({ headId: h.headId, name: h.name, student: h.student })) }));
      return NextResponse.json({ accounts });
    }
    const requests = (await refs.concessionRequests.where("academicYear", "==", academicYear).get()).docs.map((d) => d.data() as FeeConcessionRequest)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    return NextResponse.json({ requests });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/concession-requests GET]");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...OFFICE);
    const db = getAdminDb();
    const c = session.collegeId;
    const form = await request.formData();
    const val = (k: string) => { const v = form.get(k); return typeof v === "string" ? v : undefined; };
    const accountId = val("accountId") ?? "";
    if (!accountId) throw new FeeError("Select the student.");
    const file = form.get("letter");
    if (!file || typeof file === "string") throw new FeeError("Attach the letter (PDF).");
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name ?? "");
    if (!isPdf) throw new FeeError("The letter must be a PDF.");
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_LETTER_BYTES) throw new FeeError("The letter is larger than 5 MB. Attach a smaller PDF.");
    if (buffer.subarray(0, 4).toString() !== "%PDF") throw new FeeError("The letter is not a valid PDF.");

    const checked = await checkNewRequest(db, c, { accountId, amount: val("amount"), headId: val("headId") || undefined, reason: val("reason"), referralName: val("referralName"), referralDetails: val("referralDetails") });
    const refs = feeRefs(db, c);
    const ref = refs.concessionRequests.doc();
    const path = `fee-concession-letters/${c}/${ref.id}/${randomUUID()}.pdf`;
    const token = randomUUID();
    const bucket = getAdminStorage().bucket();
    await bucket.file(path).save(buffer, { metadata: { contentType: "application/pdf", metadata: { firebaseStorageDownloadTokens: token } }, resumable: false });
    const letterUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;

    const [byName, collegeSnap] = await Promise.all([actorName(db, session), refs.college.get()]);
    const a = checked.account;
    const req: FeeConcessionRequest = {
      id: ref.id, collegeId: c, collegeName: String(collegeSnap.get("name") ?? ""), accountId: a.id, academicYear: a.academicYear, studentId: a.studentId,
      rollNumber: a.rollNumber, name: a.name, department: a.department, section: a.section, courseName: a.courseName, category: a.category, funding: a.funding,
      gross: a.gross, studentShare: a.studentShare, amount: checked.amount, headId: checked.head?.headId ?? null, headName: checked.head?.name ?? null,
      reason: checked.reason, referralName: checked.referralName, ...(checked.referralDetails ? { referralDetails: checked.referralDetails } : {}),
      letterUrl, letterPath: path, letterName: String(file.name ?? "letter.pdf").slice(0, 120), status: "PENDING",
      requestedByUid: session.uid, requestedByName: byName, requestedAt: new Date().toISOString(),
    };
    await ref.set(req);
    await writeAuditLogSafe(db, c, { action: "FEE_CONCESSION_REQUESTED", performedBy: session.uid, performedByName: byName, targetId: ref.id, details: { rollNumber: a.rollNumber, amount: req.amount, referralName: req.referralName, reason: req.reason } });
    await notifyRole(db, c, "MANAGEMENT", "GENERAL", "Fee Concession Request", `${req.collegeName}: ${byName} asks a Rs. ${req.amount} fee concession for ${a.name} (${a.rollNumber}), referred by ${req.referralName}.`, "/management/fee-concessions").catch(() => undefined);
    return NextResponse.json({ request: req });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/concession-requests POST]");
  }
}
