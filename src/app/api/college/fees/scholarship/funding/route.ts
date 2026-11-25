export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { batchNotify } from "@/lib/notify";
import { paymentErrorResponse } from "@/lib/payments/server";
import { actorName, SCHOLARSHIP_ROLES } from "@/lib/fees/http";
import { FeeError, feeRefs, setFunding } from "@/lib/fees/server";
import { ACADEMIC_YEAR_RE, fundingError, normType, recompute } from "@/lib/fees/rules";
import type { FeeFunding, StudentFeeAccount } from "@/types/fees";

// Scholarship Cell > FR / NFR: mark Category A students FR (the government pays the FR-covered heads) or NFR (the
// student pays all) - one student from the list, or many from an Excel upload (Regd. No + FR / NFR).
// POST { academicYear, apply, rows: [{ rollNumber, funding, note? }] }
//   apply false: each row checked (unknown Regd. No, not Category A, not FR / NFR) and what changes - nothing written.
//   apply true: refused while any row has a problem; else each change saved in its own transaction (the shares are
//   re-worked; already paid more than the new share shows as paid extra, for Accounts). Changed students are told.
const MAX_ROWS = 3000;

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...SCHOLARSHIP_ROLES);
    const db = getAdminDb();
    const c = session.collegeId;
    const body = (await readJsonBody(request)) as { academicYear?: unknown; apply?: unknown; rows?: unknown };
    const year = String(body.academicYear ?? "");
    if (!ACADEMIC_YEAR_RE.test(year)) throw new FeeError("Select the academic year.");
    const raw = Array.isArray(body.rows) ? body.rows : [];
    if (!raw.length) throw new FeeError("There are no students to update.");
    if (raw.length > MAX_ROWS) throw new FeeError(`At most ${MAX_ROWS} students at a time.`);
    const accounts = (await feeRefs(db, c).accounts.where("academicYear", "==", year).get()).docs.map((d) => d.data() as StudentFeeAccount);
    const byRoll = new Map(accounts.map((a) => [a.rollNumber.trim().toUpperCase(), a]));
    const seen = new Set<string>();
    const checks = raw.map((r0, i) => {
      const r = (r0 ?? {}) as { rollNumber?: unknown; funding?: unknown; note?: unknown };
      const roll = String(r.rollNumber ?? "").trim().toUpperCase();
      const f = normType(r.funding).replace(/[^A-Z]/g, "");
      const funding: FeeFunding | null = f === "FR" ? "FR" : f === "NFR" ? "NFR" : null;
      const a = byRoll.get(roll);
      const base = { row: i + 1, rollNumber: roll, name: a?.name ?? "", from: a?.funding ?? null, to: funding };
      if (!roll) return { ...base, error: "No Regd. No." };
      if (seen.has(roll)) return { ...base, error: "This Regd. No is in the list more than once." };
      seen.add(roll);
      if (!funding) return { ...base, error: "Write FR or NFR." };
      if (!a) return { ...base, error: `No ${year} fee account for this Regd. No (fees not raised, or not this college).` };
      const bad = fundingError(a.category, funding);
      if (bad) return { ...base, error: bad };
      const after = recompute({ ...a, funding });
      return { ...base, accountId: a.id, change: a.funding !== funding, studentShareFrom: a.studentShare, studentShareTo: after.studentShare, paidExtra: Math.max(0, a.paid - after.studentShare), note: String(r.note ?? "").trim().slice(0, 200) };
    });
    const apply = body.apply === true;
    if (!apply) return NextResponse.json({ checks });
    if (checks.some((x) => "error" in x && x.error)) throw new FeeError("Fix the rows with problems first - nothing was saved.");
    const byName = await actorName(db, session);
    const changed: StudentFeeAccount[] = [];
    for (const x of checks) {
      if (!("change" in x) || !x.change || !x.to || !x.accountId) continue;
      const { account, changed: did } = await setFunding(db, c, { accountId: x.accountId, funding: x.to, note: x.note, byName });
      if (did) changed.push(account);
    }
    await writeAuditLogSafe(db, c, { action: "FEE_FUNDING_CHANGED", performedBy: session.uid, performedByName: byName, targetId: year, details: { changed: changed.map((a) => `${a.rollNumber}:${a.funding}`).slice(0, 200), count: changed.length } });
    for (const to of ["FR", "NFR"] as const) {
      const uids = changed.filter((a) => a.funding === to && a.studentUid).map((a) => a.studentUid!) ;
      if (uids.length) {
        await batchNotify(db, c, uids, "GENERAL", "Fee Reimbursement", to === "FR"
          ? `You are now under fee reimbursement (FR) for ${year}: the government pays part of your fee. See Fees for what you pay.`
          : `You are not under fee reimbursement (NFR) for ${year}: you pay the full fee. See Fees for what you pay.`, "/student/fees").catch(() => undefined);
      }
    }
    return NextResponse.json({ checks, changed: changed.length });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/scholarship/funding POST]");
  }
}
