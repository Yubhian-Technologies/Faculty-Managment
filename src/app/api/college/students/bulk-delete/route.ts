export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
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
// just with a bigger id list. Same cleanup as the single-student DELETE
// (students/[id]/route.ts): each student's departmentHistory subcollection
// goes with it. Capped and chunked like students/promote; callers with more
// than the cap split into multiple sequential calls.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
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

    const studentSnaps = await Promise.all(
      studentIds.map((id) => collegeRef.collection("students").doc(id).get())
    );
    const existing = studentSnaps.filter((s) => s.exists);
    const historySnaps = await Promise.all(
      existing.map((s) => s.ref.collection("departmentHistory").get())
    );

    const batch = new ChunkedBatch(db);
    const skipped: string[] = [];
    let deletedCount = 0;
    let historyIdx = 0;

    for (const snap of studentSnaps) {
      if (!snap.exists) {
        skipped.push(snap.id);
        continue;
      }
      for (const h of historySnaps[historyIdx].docs) batch.delete(h.ref);
      historyIdx++;
      batch.delete(snap.ref);
      deletedCount++;
    }

    if (deletedCount === 0) {
      return NextResponse.json({ error: "No matching students to remove" }, { status: 400 });
    }

    await batch.commit();

    const performedByName = await getUserName(db, session.collegeId, session.uid);
    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "STUDENTS_BULK_DELETED",
      performedBy: session.uid,
      performedByName,
      details: { count: deletedCount, skipped: skipped.length },
      timestamp: new Date(),
    });

    return NextResponse.json({ ok: true, deletedCount, skipped });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/students/bulk-delete POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
