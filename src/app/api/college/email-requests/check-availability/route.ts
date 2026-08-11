export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Used by College Office's Faculty Credentials request form to check a
// candidate email isn't already taken within this college before it's
// submitted. Checked against every place an institutional/login email can
// already live: assigned officialEmails, FMS login usernames, and other
// faculty-account (login) requests still pending Webmaster action - so Office
// sees the collision before sending the request, instead of Webmaster
// discovering it later at CREATE_CREDENTIALS time.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("WEBMASTER", "COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const email = (searchParams.get("email") ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const [facultyByOfficial, facultyByLogin, userDoc, officialAcctDoc, alt1AcctDoc, alt2AcctDoc] = await Promise.all([
      collegeRef.collection("facultyMembers").where("officialEmail", "==", email).limit(1).get(),
      collegeRef.collection("facultyMembers").where("collegeEmail", "==", email).limit(1).get(),
      collegeRef.collection("users").where("email", "==", email).limit(1).get(),
      collegeRef.collection("facultyAccountRequests").where("officialEmail", "==", email).limit(1).get(),
      collegeRef.collection("facultyAccountRequests").where("alternateEmail1", "==", email).limit(1).get(),
      collegeRef.collection("facultyAccountRequests").where("alternateEmail2", "==", email).limit(1).get(),
    ]);

    const taken =
      !facultyByOfficial.empty ||
      !facultyByLogin.empty ||
      !userDoc.empty ||
      !officialAcctDoc.empty ||
      !alt1AcctDoc.empty ||
      !alt2AcctDoc.empty;
    return NextResponse.json({ email, available: !taken });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/email-requests/check-availability GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
