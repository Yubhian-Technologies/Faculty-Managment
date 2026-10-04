export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { provisionStudentLogin, StudentLoginError } from "@/lib/students/provisionLogin";
import { studentPasswordError } from "@/lib/students/passwordPolicy";
import type { StudentRecord } from "@/types";

// Issues one student a real login: Roll Number (username) + the password the
// College Office types in the request. College Office only, per product decision.
// The password goes to Firebase Auth and nowhere else - it is not stored, logged,
// audited or returned. Safely re-runnable: calling this again for an already-linked
// student is a no-op that returns the existing loginEmail (use reset-login-password
// to set a new password).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const { id } = await params;

    let body: { password?: unknown };
    try {
      body = (await request.json()) as { password?: unknown };
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

    const adminAuth = await getAdminAuth();
    const result = await provisionStudentLogin(db, adminAuth, session.collegeId, id, student, session.uid, body.password as string);

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
    });
  } catch (err) {
    if (err instanceof StudentLoginError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/[id]/create-login POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
