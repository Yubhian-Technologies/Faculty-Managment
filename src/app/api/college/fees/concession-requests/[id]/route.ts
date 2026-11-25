export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { paymentErrorResponse } from "@/lib/payments/server";
import { actorName } from "@/lib/fees/http";
import { FeeError, feeRefs } from "@/lib/fees/server";
import type { FeeConcessionRequest } from "@/types/fees";

// College Office > Fees > Concession Requests > Withdraw: POST { action: "WITHDRAW" } - only while Management has
// not decided it.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const { id } = await params;
    const body = (await readJsonBody(request)) as { action?: unknown };
    if (body.action !== "WITHDRAW") throw new FeeError("Unknown action.");
    const db = getAdminDb();
    const byName = await actorName(db, session);
    const ref = feeRefs(db, session.collegeId).concessionRequests.doc(id);
    const saved = await db.runTransaction(async (tx) => {
      const r = (await tx.get(ref)).data() as FeeConcessionRequest | undefined;
      if (!r) throw new FeeError("Concession request not found. It may have been deleted.", 404);
      if (r.status !== "PENDING") throw new FeeError(`This request is already ${r.status.toLowerCase()}.`, 409);
      const next: FeeConcessionRequest = { ...r, status: "WITHDRAWN", decidedByName: byName, decidedAt: new Date().toISOString() };
      tx.set(ref, next);
      return next;
    });
    await writeAuditLogSafe(db, session.collegeId, { action: "FEE_CONCESSION_WITHDRAWN", performedBy: session.uid, performedByName: byName, targetId: id, details: { rollNumber: saved.rollNumber, amount: saved.amount } });
    return NextResponse.json({ request: saved });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/concession-requests/[id] POST]");
  }
}
