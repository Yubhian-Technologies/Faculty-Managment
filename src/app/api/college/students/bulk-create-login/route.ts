export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { provisionStudentLogin, StudentLoginError } from "@/lib/students/provisionLogin";
import { DEFAULT_STUDENT_PASSWORD } from "@/lib/students/loginDefaults";
import type { StudentRecord } from "@/types";

const MAX_STUDENTS_PER_CALL = 400; // same cap as students/bulk-delete

// Bulk variant of create-login/route.ts for the College Office roster's
// bulk-select toolbar - same per-student idempotent provisioning, just
// looped and capped like every other bulk roster action (see
// students/bulk-delete/route.ts). Continues past a single student's failure
// (e.g. missing Roll Number, duplicate Roll Number) rather than aborting the
// whole batch - each student's own outcome is reported back individually so
// Office can fix just the ones that failed.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const body = (await request.json()) as { studentIds: string[] };

    const studentIds = Array.isArray(body.studentIds) ? Array.from(new Set(body.studentIds)) : [];
    if (studentIds.length === 0) {
      return NextResponse.json({ error: "studentIds is required" }, { status: 400 });
    }
    if (studentIds.length > MAX_STUDENTS_PER_CALL) {
      return NextResponse.json(
        { error: `At most ${MAX_STUDENTS_PER_CALL} students per call - split into multiple requests` },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const adminAuth = await getAdminAuth();

    const created: { id: string; rollNumber?: string; loginEmail: string; password?: string }[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (const id of studentIds) {
      const studentSnap = await collegeRef.collection("students").doc(id).get();
      if (!studentSnap.exists) {
        skipped.push({ id, reason: "Student not found" });
        continue;
      }
      const student = studentSnap.data() as StudentRecord;
      try {
        const result = await provisionStudentLogin(db, adminAuth, session.collegeId, id, student, session.uid);
        created.push({
          id,
          rollNumber: student.rollNumber,
          loginEmail: result.loginEmail,
          password: result.alreadyExisted ? undefined : DEFAULT_STUDENT_PASSWORD,
        });
      } catch (err) {
        skipped.push({ id, reason: err instanceof Error ? err.message : "Failed to create login" });
      }
    }

    if (created.some((c) => c.password)) {
      await collegeRef.collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "STUDENT_LOGIN_CREATED",
        performedBy: session.uid,
        details: { count: created.filter((c) => c.password).length, skipped: skipped.length },
        timestamp: new Date(),
      });
    }

    return NextResponse.json({ ok: true, created, skipped });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/bulk-create-login POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
