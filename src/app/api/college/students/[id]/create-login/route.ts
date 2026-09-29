export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { provisionStudentLogin, StudentLoginError } from "@/lib/students/provisionLogin";
import { DEFAULT_STUDENT_PASSWORD } from "@/lib/students/loginDefaults";
import type { StudentRecord } from "@/types";

// Issues one student a real login (Roll Number + the shared default
// password) - College Office only, per product decision. Safely re-runnable:
// calling this again for an already-linked student is a no-op that returns
// the existing loginEmail (never the password, which we no longer know once
// created - use reset-login-password for that).
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

    const adminAuth = await getAdminAuth();
    const result = await provisionStudentLogin(db, adminAuth, session.collegeId, id, student, session.uid);

    if (!result.alreadyExisted) {
      await collegeRef.collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "STUDENT_LOGIN_CREATED",
        performedBy: session.uid,
        targetId: id,
        details: { rollNumber: student.rollNumber },
        timestamp: new Date(),
      });
    }

    return NextResponse.json({
      ok: true,
      uid: result.uid,
      loginEmail: result.loginEmail,
      alreadyExisted: result.alreadyExisted,
      // Only shown once, on the call that actually creates the login - Office
      // must hand this to the student now; it is never persisted anywhere or
      // returned again on a later call (see resetStudentLoginPassword for
      // "student forgot it").
      password: result.alreadyExisted ? undefined : DEFAULT_STUDENT_PASSWORD,
    });
  } catch (err) {
    if (err instanceof StudentLoginError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/[id]/create-login POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
