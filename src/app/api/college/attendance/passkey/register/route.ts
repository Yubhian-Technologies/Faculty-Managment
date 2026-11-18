export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { registrationOptions, verifyRegistration } from "@/lib/attendance/passkeys";
import { passkeyErrorResponse, SELF_CHECK_IN_ROLES } from "@/lib/attendance/passkeyRoutes";
import { deviceKindOf } from "@/lib/attendance/passkeyDevice";
import { noticeRegistration } from "@/lib/attendance/registrationNotice";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

// Register THIS phone for check-in (passkey, unlocked with the phone's own fingerprint / face). Refused on a computer.
// POST { step: "options" } -> WebAuthn creation options;  POST { step: "verify", response, label } -> { id, label }
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...SELF_CHECK_IN_ROLES);
    const body = (await readJsonBody(request)) as { step?: unknown; response?: unknown; label?: unknown; touchPoints?: unknown };
    const db = getAdminDb();
    const user = (await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get()).data() as { name?: string; email?: string } | undefined;
    if (body.step === "options") {
      return NextResponse.json(await registrationOptions(db, session.collegeId, session.uid, user?.email || user?.name || "", request, deviceKindOf(request.headers, body.touchPoints)));
    }
    if (body.step === "verify" && body.response && typeof body.response === "object") {
      const saved = await verifyRegistration(db, session.collegeId, session.uid, body.response as RegistrationResponseJSON, typeof body.label === "string" ? body.label : "", request);
      // Audited, and the HOD (Principal for an HOD) is told.
      await noticeRegistration(db, session.collegeId, { event: "PHONE_REGISTERED", personUid: session.uid, actorUid: session.uid, detail: saved.label });
      return NextResponse.json(saved, { status: 201 });
    }
    return NextResponse.json({ error: "Start the phone registration again." }, { status: 400 });
  } catch (err) {
    return passkeyErrorResponse(err, "attendance/passkey/register POST");
  }
}
