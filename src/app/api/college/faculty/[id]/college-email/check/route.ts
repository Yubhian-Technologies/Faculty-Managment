export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { collegeEmailConflict, normalizeCollegeEmail } from "@/lib/faculty/changeCollegeEmail";
import { EMAIL_REGEX } from "@/lib/validations";

// Live "is this address free?" for the Change College Email dialog (College Office only). Read-only. Also reports the
// faculty member's CURRENT login email and whether it agrees with their record, so the dialog can show an
// out-of-sync account up front.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const { id } = await params;
    const limit = checkRateLimit(`college-email-check:${session.uid}`, 60, 60_000);
    if (!limit.allowed) return NextResponse.json({ error: "Too many checks - please wait a moment" }, { status: 429 });

    const db = getAdminDb();
    const auth = await getAdminAuth();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("facultyMembers").doc(id).get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const f = snap.data() as { employeeId?: string; collegeEmail?: string; userUid?: string; legalName?: string };
    const recordEmail = normalizeCollegeEmail(f.collegeEmail);
    let loginEmail: string | null = null;
    if (f.userUid) loginEmail = normalizeCollegeEmail((await auth.getUser(f.userUid).catch(() => null))?.email) || null;
    const inSync = !f.userUid || loginEmail === recordEmail;

    const email = normalizeCollegeEmail(new URL(request.url).searchParams.get("email"));
    let available: boolean | null = null;
    let reason = "";
    if (email) {
      if (!EMAIL_REGEX.test(email)) { available = false; reason = "Enter a valid email address"; }
      else if (email === recordEmail) { available = false; reason = "This is already their college email"; }
      else {
        const conflict = await collegeEmailConflict(db, auth, session.collegeId, email, { uid: f.userUid, facultyId: id });
        available = !conflict;
        reason = conflict ?? "";
      }
    }
    return NextResponse.json({ employeeId: f.employeeId ?? "", recordEmail, loginEmail, inSync, hasLogin: !!f.userUid, available, reason });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/[id]/college-email/check GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
