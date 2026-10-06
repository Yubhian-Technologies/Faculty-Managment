export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember, isDepartmentOffice } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { officeModuleCatalog, sanitizeOfficeHrefs } from "@/lib/departments/officeAccess";
import { officeAccessRef } from "@/lib/attendance/officeCorrectionAccess";

// Which HOD modules this department's Department Office head may use, and
// whether they may edit student attendance.
//   GET  - the HOD (to edit) or the office head (to have their own sidebar
//          narrowed): { department, hrefs, catalog, editStudentAttendance,
//          canEditAttendance }. hrefs === null means never configured, i.e.
//          everything (the behaviour before this existed). editStudentAttendance
//          is the stored switch (off unless the HOD turned it on); canEditAttendance
//          is what THIS caller may do (always true for the HOD).
//   PUT  - the real HOD only: { hrefs?: string[], editStudentAttendance?: boolean },
//          each replacing only its own setting.
// The office head can read but never write, so they can't widen their own access.
// Stored at colleges/{id}/departmentOfficeAccess/{encoded department name}.

const docFor = officeAccessRef;

async function context() {
  const session = await requireCollegeMember("HOD");
  const db = getAdminDb();
  const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
  const department = scope.ownDepartmentNames[0] ?? "";
  return { session, db, department, ambiguous: scope.ownDepartmentNames.length > 1 };
}

const authError = (err: unknown) =>
  err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")
    ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    : null;

export async function GET() {
  try {
    const { session, db, department } = await context();
    if (!department) {
      return NextResponse.json({ department: "", hrefs: null, catalog: officeModuleCatalog(), editStudentAttendance: false, canEditAttendance: !isDepartmentOffice(session) });
    }
    const snap = await docFor(db, session.collegeId, department).get();
    const stored = (snap.data() as { hrefs?: string[]; editStudentAttendance?: boolean } | undefined) ?? {};
    const editStudentAttendance = stored.editStudentAttendance === true;
    return NextResponse.json({
      department,
      hrefs: stored.hrefs ?? null,
      catalog: isDepartmentOffice(session) ? [] : officeModuleCatalog(),
      editStudentAttendance,
      canEditAttendance: isDepartmentOffice(session) ? editStudentAttendance : true,
    });
  } catch (err) {
    const unauth = authError(err);
    if (unauth) return unauth;
    console.error("[college/department-office/access GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { session, db, department, ambiguous } = await context();
    if (isDepartmentOffice(session)) {
      return NextResponse.json({ error: "Only the Head of Department can change the Department Office's modules" }, { status: 403 });
    }
    if (ambiguous) {
      return NextResponse.json({ error: "You manage more than one department - switch to the one you are configuring first" }, { status: 400 });
    }
    if (!department) return NextResponse.json({ error: "You do not head a department" }, { status: 403 });

    const body = (await request.json().catch(() => ({}))) as { hrefs?: unknown; editStudentAttendance?: unknown };
    const hasHrefs = body.hrefs !== undefined;
    const hasFlag = body.editStudentAttendance !== undefined;
    if (!hasHrefs && !hasFlag) {
      return NextResponse.json({ error: "hrefs must be a list of known modules" }, { status: 400 });
    }
    const hrefs = hasHrefs ? sanitizeOfficeHrefs(body.hrefs) : undefined;
    if (hasHrefs && !hrefs) return NextResponse.json({ error: "hrefs must be a list of known modules" }, { status: 400 });
    if (hasFlag && typeof body.editStudentAttendance !== "boolean") {
      return NextResponse.json({ error: "editStudentAttendance must be true or false" }, { status: 400 });
    }

    const ref = docFor(db, session.collegeId, department);
    const before = ((await ref.get()).data() as { editStudentAttendance?: boolean } | undefined)?.editStudentAttendance === true;
    const now = new Date();
    // Merged, so saving the module list never wipes the attendance switch (or the reverse).
    await ref.set(
      { department, ...(hrefs ? { hrefs } : {}), ...(hasFlag ? { editStudentAttendance: body.editStudentAttendance } : {}), updatedBy: session.uid, updatedAt: now },
      { merge: true }
    );
    // A change of who may rewrite attendance is itself recorded.
    if (hasFlag && before !== body.editStudentAttendance) {
      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "DEPARTMENT_OFFICE_ATTENDANCE_ACCESS_CHANGED",
        performedBy: session.uid,
        targetId: encodeURIComponent(department),
        details: { department, enabled: body.editStudentAttendance },
        timestamp: now,
      });
    }
    return NextResponse.json({ department, ...(hrefs ? { hrefs } : {}), ...(hasFlag ? { editStudentAttendance: body.editStudentAttendance } : {}) });
  } catch (err) {
    const unauth = authError(err);
    if (unauth) return unauth;
    console.error("[college/department-office/access PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
