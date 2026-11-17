export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { listPasskeys, removePasskey, selfCheckInMethod } from "@/lib/attendance/passkeys";
import { passkeyErrorResponse, SELF_CHECK_IN_ROLES } from "@/lib/attendance/passkeyRoutes";

// Phone check-in (passkey) - lib/attendance/passkeys.ts.
// GET -> { method, passkeys: [{ id, label, createdAt, lastUsedAt }] }  (the caller's own phones)
// DELETE ?id= -> removes one of the caller's own phones
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

export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember(...SELF_CHECK_IN_ROLES);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) return NextResponse.json({ error: "Select a phone." }, { status: 400 });
    await removePasskey(getAdminDb(), session.collegeId, session.uid, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return passkeyErrorResponse(err, "attendance/passkey DELETE");
  }
}
