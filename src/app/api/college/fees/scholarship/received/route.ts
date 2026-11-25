export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { paymentErrorResponse } from "@/lib/payments/server";
import { requireScholarshipManager } from "@/lib/fees/http";
import { addGovtReceived, FeeError, feeRefs, todayIst } from "@/lib/fees/server";
import { ACADEMIC_YEAR_RE, DATE_RE } from "@/lib/fees/rules";
import type { StudentFeeAccount } from "@/types/fees";

// Scholarship Cell > Government Receipts: fee reimbursement money the government paid into the college's account.
// GET ?academicYear=   the credits recorded (newest first)
// POST { academicYear, receivedOn, reference, scheme?, apply, rows: [{ rollNumber, amount }] }
//   apply false: each row checked (FR student of that year, whole rupees; more than the government's share is
//   flagged) - nothing written. apply true: refused while any row has a problem; the credit is kept and each
//   student's "government received" goes up.
const MAX_ROWS = 3000;

export async function GET(request: Request) {
  try {
    const session = await requireScholarshipManager(getAdminDb(), request);
    const year = new URL(request.url).searchParams.get("academicYear") ?? "";
    if (!ACADEMIC_YEAR_RE.test(year)) throw new FeeError("Select the academic year.");
    const snap = await feeRefs(getAdminDb(), session.collegeId).govtCredits.where("academicYear", "==", year).get();
    type Credit = { academicYear: string; receivedOn: string; reference: string; scheme: string; total: number; rows: unknown[]; createdAt: string; byName: string };
    const credits = snap.docs.map((d) => {
      const v = d.data() as Credit;
      return { id: d.id, receivedOn: v.receivedOn, reference: v.reference, scheme: v.scheme, total: v.total, students: v.rows?.length ?? 0, createdAt: v.createdAt, byName: v.byName };
    }).sort((a, b) => b.receivedOn.localeCompare(a.receivedOn));
    return NextResponse.json({ credits });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/scholarship/received GET]");
  }
}

export async function POST(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireScholarshipManager(db, request);
    const c = session.collegeId;
    const body = (await readJsonBody(request)) as { academicYear?: unknown; receivedOn?: unknown; reference?: unknown; scheme?: unknown; apply?: unknown; rows?: unknown };
    const year = String(body.academicYear ?? "");
    const receivedOn = String(body.receivedOn ?? "");
    const reference = String(body.reference ?? "").trim().slice(0, 80);
    const scheme = String(body.scheme ?? "").trim().slice(0, 80);
    if (!ACADEMIC_YEAR_RE.test(year)) throw new FeeError("Select the academic year.");
    if (!DATE_RE.test(receivedOn) || receivedOn > todayIst()) throw new FeeError("Enter the date the money was received (not in the future).");
    if (!reference) throw new FeeError("Enter the reference (government order / UTR).");
    const raw = Array.isArray(body.rows) ? body.rows : [];
    if (!raw.length) throw new FeeError("There are no students in the list.");
    if (raw.length > MAX_ROWS) throw new FeeError(`At most ${MAX_ROWS} students at a time.`);
    const accounts = (await feeRefs(db, c).accounts.where("academicYear", "==", year).get()).docs.map((d) => d.data() as StudentFeeAccount);
    const byRoll = new Map(accounts.map((a) => [a.rollNumber.trim().toUpperCase(), a]));
    const seen = new Set<string>();
    const checks = raw.map((r0, i) => {
      const r = (r0 ?? {}) as { rollNumber?: unknown; amount?: unknown };
      const roll = String(r.rollNumber ?? "").trim().toUpperCase();
      const amount = Number(r.amount);
      const a = byRoll.get(roll);
      const base = { row: i + 1, rollNumber: roll, name: a?.name ?? "", amount };
      if (!roll) return { ...base, error: "No Regd. No." };
      if (seen.has(roll)) return { ...base, error: "This Regd. No is in the list more than once." };
      seen.add(roll);
      if (!Number.isInteger(amount) || amount <= 0) return { ...base, error: "Enter the amount in whole rupees." };
      if (!a) return { ...base, error: `No ${year} fee account for this Regd. No.` };
      if (a.funding !== "FR") return { ...base, error: "This student is not FR. Mark them FR first." };
      const after = (a.govtReceived ?? 0) + amount;
      return { ...base, accountId: a.id, govtShare: a.govtShare, receivedAfter: after, ...(after > a.govtShare ? { note: `More than the government's share (Rs. ${a.govtShare}) by Rs. ${after - a.govtShare}` } : {}) };
    });
    const total = checks.reduce((n, x) => n + (Number.isInteger(x.amount) ? x.amount : 0), 0);
    if (body.apply !== true) return NextResponse.json({ checks, total });
    if (checks.some((x) => "error" in x && x.error)) throw new FeeError("Fix the rows with problems first - nothing was saved.");
    const byName = session.byName;
    const ref = feeRefs(db, c).govtCredits.doc();
    const rows = checks.map((x) => ({ accountId: (x as { accountId: string }).accountId, rollNumber: x.rollNumber, amount: x.amount }));
    await ref.set({ academicYear: year, receivedOn, reference, scheme, total, rows, createdAt: new Date().toISOString(), byName });
    await addGovtReceived(db, c, rows, ref.id, byName);
    await writeAuditLogSafe(db, c, { action: "FEE_GOVT_RECEIVED", performedBy: session.uid, performedByName: byName, targetId: ref.id, details: { academicYear: year, receivedOn, reference, total, students: rows.length } });
    return NextResponse.json({ checks, total, creditId: ref.id });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/scholarship/received POST]");
  }
}
