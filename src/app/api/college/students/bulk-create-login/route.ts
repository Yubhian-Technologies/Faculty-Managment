export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { provisionStudentLogin, StudentLoginError } from "@/lib/students/provisionLogin";
import { studentPasswordError } from "@/lib/students/passwordPolicy";
import type { StudentRecord } from "@/types";

const MAX_STUDENTS_PER_CALL = 400; // same cap as students/bulk-delete

// Bulk variant of create-login/route.ts for the College Office roster's
// bulk-select toolbar - same per-student idempotent provisioning, just
// looped and capped like every other bulk roster action (see
// students/bulk-delete/route.ts). Continues past a single student's failure
// (e.g. missing Roll Number, duplicate Roll Number) rather than aborting the
// whole batch - each student's own outcome is reported back individually so
// Office can fix just the ones that failed.
//
// Passwords are supplied by the caller, never generated here. Either one
// `password` for every selected student (the office's explicit choice - students
// can change it themselves afterwards), or `logins: [{ id, password }]` for a
// different password each. They go to Firebase Auth only and are never echoed back.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    let body: { studentIds?: unknown; password?: unknown; logins?: unknown };
    try {
      body = (await readJsonBody(request)) as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    // id -> password, from whichever form the caller used.
    const requested = new Map<string, string>();
    if (Array.isArray(body.logins)) {
      for (const entry of body.logins as { id?: unknown; password?: unknown }[]) {
        if (typeof entry?.id === "string" && entry.id.trim() && typeof entry.password === "string" && !requested.has(entry.id)) {
          requested.set(entry.id, entry.password);
        }
      }
    } else if (Array.isArray(body.studentIds)) {
      const commonProblem = studentPasswordError(body.password);
      if (commonProblem) return NextResponse.json({ error: commonProblem }, { status: 400 });
      for (const id of body.studentIds) {
        if (typeof id === "string" && id.trim() && !requested.has(id)) requested.set(id, body.password as string);
      }
    }
    if (requested.size === 0) {
      return NextResponse.json({ error: "studentIds is required" }, { status: 400 });
    }
    if (requested.size > MAX_STUDENTS_PER_CALL) {
      return NextResponse.json(
        { error: `At most ${MAX_STUDENTS_PER_CALL} students per call - split into multiple requests` },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const adminAuth = await getAdminAuth();

    const created: { id: string; name: string; rollNumber?: string; loginEmail: string }[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (const [id, password] of requested) {
      const studentSnap = await collegeRef.collection("students").doc(id).get();
      if (!studentSnap.exists) {
        skipped.push({ id, reason: "Student not found" });
        continue;
      }
      const student = studentSnap.data() as StudentRecord;
      try {
        const result = await provisionStudentLogin(db, adminAuth, session.collegeId, id, student, session.uid, password);
        if (result.alreadyExisted) {
          skipped.push({ id, reason: "Already has a login" });
        } else {
          created.push({ id, name: student.name, rollNumber: student.rollNumber, loginEmail: result.loginEmail });
        }
      } catch (err) {
        const badBody = badBodyResponse(err);
        if (badBody) return badBody;
        // Only the deliberate, user-facing reasons (missing roll, duplicate roll,
        // weak password...) are shown; anything else is logged and reported generically.
        if (err instanceof StudentLoginError) {
          skipped.push({ id, reason: err.message });
        } else {
          console.error("[college/students/bulk-create-login] provisioning failed", id, err);
          skipped.push({ id, reason: "Failed to create login - try again" });
        }
      }
    }

    if (created.length > 0) {
      await collegeRef.collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "STUDENT_LOGIN_CREATED",
        performedBy: session.uid,
        details: { count: created.length, skipped: skipped.length },
        timestamp: new Date(),
      });
    }

    return NextResponse.json({ ok: true, created, skipped });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/bulk-create-login POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
