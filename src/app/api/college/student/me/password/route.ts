export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { findOwnStudent } from "@/lib/students/ownContext";
import { clearMustChangePassword } from "@/lib/students/provisionLogin";
import { passwordChangeRequired } from "@/lib/students/passwordGate";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";

// The student portal's "do I have to set a new password?" check, and the
// acknowledgement once they have. Deliberately exempt from the password gate
// that every other /me route enforces (see lib/students/passwordGate.ts) - this
// is how a held student gets out of it. The password itself is changed in the
// browser with Firebase's client SDK; this only records that it was.
export async function GET() {
  try {
    const session = await requireCollegeMember("STUDENT");
    const found = await findOwnStudent(getAdminDb(), session.collegeId, session.uid);
    return NextResponse.json({ mustChangePassword: found.ok ? passwordChangeRequired(found.student) : false });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student/me/password GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const found = await findOwnStudent(db, session.collegeId, session.uid);
    if (!found.ok) {
      return NextResponse.json({ error: "Your login is not linked to a student record yet." }, { status: 404 });
    }
    if (passwordChangeRequired(found.student)) {
      await clearMustChangePassword(db, session.collegeId, found.student.id, session.uid);
      await writeAuditLog(db, session.collegeId, {
        action: "STUDENT_PASSWORD_CHANGED",
        performedBy: session.uid,
        targetId: found.student.id,
        details: { rollNumber: found.student.rollNumber },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student/me/password POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
