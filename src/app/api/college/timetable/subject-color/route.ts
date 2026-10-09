export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { isTimetableIncharge } from "@/lib/departments/timetableIncharge";
import { isSubjectColor } from "@/lib/timetable/subjectColors";

// Sets (or clears, color = null) the cell color of one teaching assignment's subject.
export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF");
    const body = (await readJsonBody(request)) as { assignmentId?: string; color?: string | null };
    const { assignmentId } = body;
    const color = body.color ?? null;
    if (!assignmentId) return NextResponse.json({ error: "assignmentId is required" }, { status: 400 });
    if (color !== null && !isSubjectColor(color)) return NextResponse.json({ error: "Unknown color" }, { status: 400 });

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const ref = collegeRef.collection("teachingAssignments").doc(assignmentId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const a = snap.data() as { department?: string; courseId?: string; year?: number; sectionId?: string; subjectId?: string };

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartment(scope, a.department ?? "")) {
        return NextResponse.json({ error: "This subject isn't in your department" }, { status: 403 });
      }
    } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      const ok = a.courseId && a.year != null &&
        (await isTimetableIncharge(db, session.collegeId, session.uid, a.courseId, a.year));
      if (!ok) return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
    }

    // A co-taught/split subject (several faculty teaching the same subject in
    // the same section, e.g. a lab split into batches) is several separate
    // teaching-assignment docs - colour all of them together, so the colour
    // reflects on every faculty's half, on screen and after publish, not just
    // whichever one was clicked.
    const batch = db.batch();
    batch.update(ref, { cellColor: color });
    if (a.sectionId && a.subjectId) {
      const siblingsSnap = await collegeRef.collection("teachingAssignments")
        .where("sectionId", "==", a.sectionId)
        .where("subjectId", "==", a.subjectId)
        .get();
      for (const d of siblingsSnap.docs) {
        if (d.id !== assignmentId) batch.update(d.ref, { cellColor: color });
      }
    }
    await batch.commit();
    return NextResponse.json({ success: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[timetable/subject-color PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
