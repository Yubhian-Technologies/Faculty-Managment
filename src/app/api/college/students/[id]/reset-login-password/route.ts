export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { StudentLoginError, resetStudentLoginPassword } from "@/lib/students/provisionLogin";
import { studentPasswordError } from "@/lib/students/passwordPolicy";
import type { StudentRecord } from "@/types";

// Sets a student's login to a NEW password the College Office types in the
// request - the only password-recovery path for students (their login email is
// synthetic, so Firebase's own "forgot password" email can't reach them). The
// password goes to Firebase Auth only; it is not stored, logged, audited or
// returned. College Office only, same as create-login. Students can also change
// their own password at any time.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const { id } = await params;

    let body: { password?: unknown };
    try {
      body = (await readJsonBody(request)) as { password?: unknown };
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const passwordProblem = studentPasswordError(body?.password);
    if (passwordProblem) return NextResponse.json({ error: passwordProblem }, { status: 400 });

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
    await resetStudentLoginPassword(adminAuth, student.uid, body.password as string);

    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "STUDENT_LOGIN_PASSWORD_RESET",
      performedBy: session.uid,
      targetId: id,
      timestamp: new Date(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof StudentLoginError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/[id]/reset-login-password POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
