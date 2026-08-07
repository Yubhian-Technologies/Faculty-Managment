export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Used by the Webmaster's create-email form to check a candidate email (either
// a College Office-suggested preferred email, or one the Webmaster typed) isn't
// already taken within this college before it's assigned. Checked against every
// place an institutional/login email can already live: assigned officialEmails,
// FMS login usernames, and other outstanding requests targeting the same address.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("WEBMASTER", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const email = (searchParams.get("email") ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const [facultyByOfficial, facultyByLogin, userDoc, requestDoc] = await Promise.all([
      db.collection("colleges").doc(session.collegeId).collection("facultyMembers").where("officialEmail", "==", email).limit(1).get(),
      db.collection("colleges").doc(session.collegeId).collection("facultyMembers").where("collegeEmail", "==", email).limit(1).get(),
      db.collection("colleges").doc(session.collegeId).collection("users").where("email", "==", email).limit(1).get(),
      db.collection("colleges").doc(session.collegeId).collection("emailRequests").where("assignedEmail", "==", email).limit(1).get(),
    ]);

    const taken = !facultyByOfficial.empty || !facultyByLogin.empty || !userDoc.empty || !requestDoc.empty;
    return NextResponse.json({ email, available: !taken });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/email-requests/check-availability GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
