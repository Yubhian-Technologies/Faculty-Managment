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
    const ref = db.collection("colleges").doc(session.collegeId).collection("teachingAssignments").doc(assignmentId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const a = snap.data() as { department?: string; courseId?: string; year?: number };

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

    await ref.update({ cellColor: color });
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
