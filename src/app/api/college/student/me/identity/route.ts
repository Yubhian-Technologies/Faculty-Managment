export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// The signed-in student's Roll No - what the sidebar / drawer user card shows under their name instead of the generated
// internal login email. Read-only, resolved from session.uid only (like every other student/me/* route), one lookup.
export async function GET() {
  try {
    const session = await requireCollegeMember("STUDENT");
    const snap = await getAdminDb().collection("colleges").doc(session.collegeId).collection("students").where("uid", "==", session.uid).limit(1).get();
    const rollNumber = snap.empty ? "" : String((snap.docs[0].data() as { rollNumber?: string }).rollNumber ?? "").trim();
    return NextResponse.json({ rollNumber });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student/me/identity GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
