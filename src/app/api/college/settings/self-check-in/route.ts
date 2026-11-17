export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { SELF_CHECK_IN_METHODS, selfCheckInMethod, type SelfCheckInMethod } from "@/lib/attendance/passkeys";
import { passkeyErrorResponse } from "@/lib/attendance/passkeyRoutes";

// How faculty and staff check themselves in, per college: FACE (default - the face scan), PASSKEY (the registered
// phone's own fingerprint / face unlock) or EITHER. Set by the same people as Attendance Timings.
const EDITORS = ["PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE"];

export async function GET() {
  try {
    const session = await requireCollegeMember(...EDITORS);
    return NextResponse.json({ method: await selfCheckInMethod(getAdminDb(), session.collegeId) });
  } catch (err) {
    return passkeyErrorResponse(err, "settings/self-check-in GET");
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember(...EDITORS);
    const body = (await readJsonBody(request)) as { method?: unknown };
    if (!SELF_CHECK_IN_METHODS.includes(body.method as SelfCheckInMethod)) {
      return NextResponse.json({ error: "Select a check-in method." }, { status: 400 });
    }
    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("settings").doc("selfCheckIn");
    const before = await selfCheckInMethod(db, session.collegeId);
    await ref.set({ method: body.method, updatedAt: new Date(), updatedBy: session.uid }, { merge: true });
    const actor = (await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get()).data() as { name?: string } | undefined;
    await writeAuditLogSafe(db, session.collegeId, {
      action: "SELF_CHECK_IN_METHOD_CHANGED", performedBy: session.uid, performedByName: actor?.name, targetId: "selfCheckIn",
      details: { from: before, to: body.method },
    });
    return NextResponse.json({ method: body.method });
  } catch (err) {
    return passkeyErrorResponse(err, "settings/self-check-in PUT");
  }
}
