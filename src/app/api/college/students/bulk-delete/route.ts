export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { invalidateSectionCountCache } from "@/lib/students/sectionCounts";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { deleteStudentsCompletely } from "@/lib/students/deleteStudent";
import type { Firestore } from "firebase-admin/firestore";

const MAX_STUDENTS_PER_CALL = 400;

async function getUserName(db: Firestore, collegeId: string, uid: string): Promise<string> {
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    return (snap.data() as { name?: string } | undefined)?.name ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

// Bulk removal for the College Office roster tab. Deliberately takes a flat
// studentIds array rather than separate "all" / "by department" modes - the
// page already lets Office filter the visible roster (search/department/year)
// and select-all within that view, so "delete everyone in a department" and
// "delete all students" both resolve to the same call as "delete selected",
// just with a bigger id list. Same permanent, complete deletion as the
// single-student DELETE (students/[id]/route.ts, see lib/students/deleteStudent.ts):
// each student's record, department history, login and roll registry entry go
// with them and nothing is archived. Capped; callers with more than the cap
// split into multiple sequential calls.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    invalidateSectionCountCache(session.collegeId); // student counts on the Sections list change with this write
    const body = (await readJsonBody(request)) as { studentIds: string[] };

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

    const studentSnaps = await Promise.all(
      studentIds.map((id) => collegeRef.collection("students").doc(id).get())
    );
    const existing = studentSnaps.filter((s) => s.exists);
    const skipped = studentSnaps.filter((s) => !s.exists).map((s) => s.id);

    if (existing.length === 0) {
      return NextResponse.json({ error: "No matching students to remove" }, { status: 400 });
    }

    const { deletedIds, failedIds } = await deleteStudentsCompletely(db, getAdminAuth, session.collegeId, existing);
    const deletedCount = deletedIds.length;

    if (deletedCount > 0) {
      const performedByName = await getUserName(db, session.collegeId, session.uid);
      await collegeRef.collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "STUDENTS_BULK_DELETED",
        performedBy: session.uid,
        performedByName,
        details: { count: deletedCount, skipped: skipped.length, ...(failedIds.length > 0 ? { failed: failedIds.length } : {}) },
        timestamp: new Date(),
      });
    }

    return NextResponse.json({ ok: true, deletedCount, skipped, failed: failedIds });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/bulk-delete POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
