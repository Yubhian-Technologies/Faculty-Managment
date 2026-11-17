export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { CHANGE_REGISTRATION_MESSAGE, listPasskeys, selfCheckInMethod } from "@/lib/attendance/passkeys";
import { passkeyErrorResponse, SELF_CHECK_IN_ROLES } from "@/lib/attendance/passkeyRoutes";

// Phone check-in (passkey) - lib/attendance/passkeys.ts.
// GET -> { method, passkeys: [{ id, label, createdAt, lastUsedAt }] }  (the caller's own phones)
// DELETE -> refused: changing the registered phone is the HOD's reset (face-registration/reset), never self-service.
export async function GET() {
  try {
    const session = await requireCollegeMember(...SELF_CHECK_IN_ROLES);
    const db = getAdminDb();
    const [method, passkeys] = await Promise.all([selfCheckInMethod(db, session.collegeId), listPasskeys(db, session.collegeId, session.uid)]);
    return NextResponse.json({ method, passkeys });
  } catch (err) {
    return passkeyErrorResponse(err, "attendance/passkey GET");
  }
}

export async function DELETE() {
  try {
    await requireCollegeMember(...SELF_CHECK_IN_ROLES);
    return NextResponse.json({ error: `Your registered phone can't be removed here. ${CHANGE_REGISTRATION_MESSAGE}` }, { status: 403 });
  } catch (err) {
    return passkeyErrorResponse(err, "attendance/passkey DELETE");
  }
}
