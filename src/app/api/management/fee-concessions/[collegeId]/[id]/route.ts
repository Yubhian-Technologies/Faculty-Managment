export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { notify } from "@/lib/notify";
import { paymentErrorResponse } from "@/lib/payments/server";
import { actorName } from "@/lib/fees/http";
import { FeeError } from "@/lib/fees/server";
import { decideRequest } from "@/lib/fees/concessions";

// Management > Fee Concessions > decide: POST { action: "APPROVE" | "REJECT", amount?, remarks? }.
// APPROVE (the amount asked, or less) adds the concession to the student's fee in the same transaction; REJECT needs
// remarks. The College Office member who asked and the student are told.
export async function POST(request: Request, { params }: { params: Promise<{ collegeId: string; id: string }> }) {
  try {
    const session = await requireManagement();
    const { collegeId, id } = await params;
    const db = getAdminDb();
    if (!(await db.collection("colleges").doc(collegeId).get()).exists) throw new FeeError("College not found.", 404);
    const body = (await readJsonBody(request)) as { action?: unknown; amount?: unknown; remarks?: unknown };
    const byName = await actorName(db, session);
    const { request: r, account } = await decideRequest(db, collegeId, { requestId: id, action: body.action, amount: body.amount, remarks: body.remarks, byName });
    const approved = r.status === "APPROVED";
    await writeAuditLogSafe(db, collegeId, {
      action: approved ? "FEE_CONCESSION_APPROVED" : "FEE_CONCESSION_REJECTED", performedBy: session.uid, performedByName: byName, targetId: id,
      details: { rollNumber: r.rollNumber, asked: r.amount, approved: r.approvedAmount ?? 0, referralName: r.referralName, remarks: r.remarks ?? "" },
    });
    const text = approved
      ? `Management approved a Rs. ${r.approvedAmount} fee concession for ${r.name} (${r.rollNumber})${r.approvedAmount !== r.amount ? ` (asked Rs. ${r.amount})` : ""}.`
      : `Management rejected the Rs. ${r.amount} fee concession for ${r.name} (${r.rollNumber}): ${r.remarks}`;
    await notify(db, collegeId, r.requestedByUid, "GENERAL", "Fee Concession Request", text, "/college-office/fees/concessions").catch(() => undefined);
    if (approved && account?.studentUid) {
      await notify(db, collegeId, account.studentUid, "GENERAL", "Fee Concession", `A concession of Rs. ${r.approvedAmount} was given on your ${r.academicYear} fees. You now pay Rs. ${account.studentShare}.`, "/student/fees").catch(() => undefined);
    }
    return NextResponse.json({ request: r });
  } catch (err) {
    return paymentErrorResponse(err, "[management/fee-concessions/[collegeId]/[id] POST]");
  }
}
