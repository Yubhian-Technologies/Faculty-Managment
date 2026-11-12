export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getDepartmentHeadUids, notify, notifyRole } from "@/lib/notify";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { nextApproval, type ApprovalAction } from "@/lib/midBank/approval";
import { actorName, bankAccess, guardError, MID_BANK_WRITE_ROLES, midBankRefs } from "@/lib/midBank/server";
import type { MidBankApprovalEntry, MidQuestionBank } from "@/types";

// HOD approval of one question bank.
//   { action: "submit" }              the owner, once every unit is complete
//   { action: "withdraw" }            the owner, while the HOD hasn't decided
//   { action: "approve" }             the reviewing HOD - the Exam Cell can now use it
//   { action: "return", remarks }     the reviewing HOD - back to the owner to change
// The reviewing HOD is a subject department's (set by Academics; with two, both are told and either
// one decides), else the branch's. The history records who decided, as which department.
// A submitted / approved bank is read-only (bankAccess.frozen). Every step is
// kept on the bank (approvalHistory) and in the audit log.

type Params = { params: Promise<{ id: string }> };
const ACTIONS: ApprovalAction[] = ["submit", "withdraw", "approve", "return"];

export async function POST(request: Request, { params }: Params) {
  try {
    const body = (await readJsonBody(request)) as { action?: string; remarks?: string };
    const action = body.action as ApprovalAction;
    if (!ACTIONS.includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    // Deciding is the HOD's; submitting / withdrawing the preparing faculty's.
    const session = action === "approve" || action === "return" ? await requireCollegeMember("HOD") : await requireCollegeMember(...MID_BANK_WRITE_ROLES);
    const { id } = await params;
    const db = getAdminDb();
    const access = await bankAccess(db, session, id);
    if (!access) return NextResponse.json({ error: "Question bank not found" }, { status: 404 });
    const name = (await actorName(db, session.collegeId, session.uid)) || session.email || "";
    const remarks = body.remarks?.trim() || undefined;
    const ref = midBankRefs(db, session.collegeId).banks.doc(id);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { status: 404, body: { error: "Question bank not found" } };
      const bank = { ...(snap.data() as MidQuestionBank), id };
      if (bank.withdrawn) return { status: 409, body: { error: "The HOD removed this setter - it is withdrawn, nothing to submit or decide" } };
      const next = nextApproval(bank, action, { isOwner: access.isOwner, isHod: access.isHod }, remarks);
      if ("error" in next) return { status: 409, body: { error: next.error } };
      const entry: MidBankApprovalEntry = { at: new Date().toISOString(), byUid: session.uid, byName: name, action: action === "withdraw" ? "WITHDRAWN" : next.approval!, ...(remarks ? { remarks } : {}), department: action === "approve" || action === "return" ? access.hodDepartment : access.reviewDepartments.join(", ") };
      tx.update(ref, {
        approval: next.approval ?? FieldValue.delete(),
        approvalHistory: [...(bank.approvalHistory ?? []), entry],
        // Approved again after the Exam Cell reopened it: back to the normal deadline rules.
        ...(action === "approve" && bank.reopened ? { reopened: FieldValue.delete() } : {}),
        updatedAt: new Date(),
      });
      return { status: 200, body: { approval: next.approval, bank } };
    });
    if (result.status !== 200) return NextResponse.json(result.body, { status: result.status });

    const bank = (result.body as { bank: MidQuestionBank }).bank;
    const what = `${bank.subjectName} (${bank.subjectCode}) · ${bank.branch} · Mid ${bank.midNumber}`;
    const label = bank.kind === "PAPERS" ? "Question papers" : "Question bank";
    if (action === "submit") {
      const heads = new Set((await Promise.all(access.reviewDepartments.map((dep) => getDepartmentHeadUids(db, session.collegeId, dep)))).flat());
      for (const uid of heads) {
        await notify(db, session.collegeId, uid, "MID_BANK_SUBMITTED", `${label} submitted for approval`, `${bank.ownerName}: ${what}`, `/hod/question-banks/${encodeURIComponent(bank.deadlineId)}/${encodeURIComponent(id)}`);
      }
    } else if (action === "approve" || action === "return") {
      if (bank.ownerUid) {
        await notify(db, session.collegeId, bank.ownerUid, "MID_BANK_REVIEWED",
          action === "approve" ? `${label} approved by the HOD` : `${label} returned by the HOD`,
          action === "approve" ? what : `${what} - ${remarks}`, `/panel/mid-bank/${encodeURIComponent(id)}/review`);
      }
      if (action === "approve") await notifyRole(db, session.collegeId, "EXAM_CELL", "MID_BANK_APPROVED", `${label} approved`, `${what} - ${bank.ownerName}`, `/exam-cell/question-banks/${encodeURIComponent(bank.deadlineId)}/${encodeURIComponent(id)}`);
    }
    await writeAuditLogSafe(db, session.collegeId, {
      action: `MID_BANK_${action.toUpperCase()}`, performedBy: session.uid, performedByName: name, targetId: id,
      details: { bank: what, owner: bank.ownerName, reviewDepartments: access.reviewDepartments, ...(access.hodDepartment ? { decidedAs: access.hodDepartment } : {}), ...(remarks ? { remarks } : {}) },
    });
    return NextResponse.json({ approval: (result.body as { approval: string | null }).approval });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-question-banks/[id]/approval POST]");
  }
}
