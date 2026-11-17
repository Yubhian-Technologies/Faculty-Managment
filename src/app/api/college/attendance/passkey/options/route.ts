export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { allowsPasskey, authenticationOptions, selfCheckInMethod } from "@/lib/attendance/passkeys";
import { passkeyErrorResponse, SELF_CHECK_IN_ROLES } from "@/lib/attendance/passkeyRoutes";

// POST -> WebAuthn request options for a check-in / check-out signature (one use, 5 minutes). The signed response is
// sent with the check-in / check-out itself, which verifies it (attendanceProof.ts).
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...SELF_CHECK_IN_ROLES);
    const db = getAdminDb();
    if (!allowsPasskey(await selfCheckInMethod(db, session.collegeId))) {
      return NextResponse.json({ error: "Phone fingerprint / face unlock check-in is not turned on for your college." }, { status: 400 });
    }
    return NextResponse.json(await authenticationOptions(db, session.collegeId, session.uid, request));
  } catch (err) {
    return passkeyErrorResponse(err, "attendance/passkey/options POST");
  }
}
