export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { resetStudentLoginPassword } from "@/lib/students/provisionLogin";
import { describeLoginFailure } from "@/lib/students/loginErrors";
import { DEFAULT_STUDENT_PASSWORD } from "@/lib/students/loginDefaults";
import type { StudentRecord } from "@/types";

// Resets a student's login back to the shared default password - the only
// password-recovery path for students (their login email is synthetic, so
// Firebase's own "forgot password" email can't reach them). College Office
// only, same as create-login.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const { id } = await params;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const studentSnap = await collegeRef.collection("students").doc(id).get();
    if (!studentSnap.exists) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }
    const student = studentSnap.data() as StudentRecord;
    if (!student.uid) {
      return NextResponse.json({ error: "This student has no login to reset - create one first" }, { status: 400 });
    }

    const adminAuth = await getAdminAuth();
    await resetStudentLoginPassword(adminAuth, student.uid);

    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "STUDENT_LOGIN_PASSWORD_RESET",
      performedBy: session.uid,
      targetId: id,
      timestamp: new Date(),
    });

    return NextResponse.json({ ok: true, password: DEFAULT_STUDENT_PASSWORD });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/[id]/reset-login-password POST]", err);
    const failure = describeLoginFailure(err);
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}
