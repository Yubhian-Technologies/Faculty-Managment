export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { canHodEditDepartmentYear, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import { isTimetableIncharge } from "@/lib/departments/timetableIncharge";
import type { Department } from "@/types";

// A subject the HOD / sub-HOD / Timetable Incharge types in by hand (e.g. NSS,
// Sports, a one-off activity) for ONE section's department + semester. It is
// filed exactly like an Assign-to-Semester subject (subjects doc + its
// subjectSemesterAssignments instance) so the picker, the server legitimacy
// check and the timetable all treat it normally. `isCustom` is what keeps it
// out of the faculty resume (see teaching-assignments POST / buildTeachingLoadRows).
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF");
    const body = (await readJsonBody(request)) as { courseId?: string; sectionId?: string; semester?: number; name?: string };
    const name = body.name?.trim() ?? "";
    const semester = Number(body.semester);
    if (!body.courseId || !body.sectionId || !name || !Number.isInteger(semester) || semester < 1) {
      return NextResponse.json({ error: "courseId, sectionId, semester and a subject name are required" }, { status: 400 });
    }
    if (name.length > 80) return NextResponse.json({ error: "Subject name is too long" }, { status: 400 });

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const [courseSnap, sectionSnap, deptsSnap] = await Promise.all([
      collegeRef.collection("courses").doc(body.courseId).get(),
      collegeRef.collection("sections").doc(body.sectionId).get(),
      collegeRef.collection("departments").get(),
    ]);
    if (!courseSnap.exists) return NextResponse.json({ error: "Course not found" }, { status: 404 });
    if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    const course = courseSnap.data() as { name: string; catalogId?: string };
    const section = sectionSnap.data() as { year: number; department: string };
    const allDepartments = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as (DepartmentYearRow & Pick<Department, "name">)[];

    // Same scope rules as staffing a section (teaching-assignments POST).
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartmentYear(scope, allDepartments, section.department, section.year, course.catalogId)) {
        return NextResponse.json({ error: "Section is not in your department, one of your sub-departments, or a year your department manages" }, { status: 403 });
      }
    } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      if (!(await isTimetableIncharge(db, session.collegeId, session.uid, body.courseId, section.year))) {
        return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
      }
    }

    const dept = allDepartments.find((d) => d.name === section.department);
    if (!dept) return NextResponse.json({ error: "Section's department not found" }, { status: 404 });

    const now = new Date();
    const subjectRef = collegeRef.collection("subjects").doc();
    // The typed name doubles as the code, so every place that shows a code
    // (grid, PDFs, allocation list) reads naturally. Uniqueness is by doc id.
    const code = name;
    // shortCode is what timetable cells show (falling back to `code`), so it
    // carries the typed name - otherwise the grid would show "CUS-AB12C".
    const base = { collegeId: session.collegeId, courseId: body.courseId, courseName: course.name, name, code, shortCode: name, type: "THEORY", hoursPerWeek: 0, credits: 0, isCustom: true };
    const subjectDoc = { ...base, isActive: true, createdAt: now, updatedAt: now };
    const assignmentDoc = {
      ...base,
      subjectId: subjectRef.id,
      subjectName: name,
      subjectCode: code,
      departmentId: dept.id,
      departmentName: dept.name,
      department: dept.name,
      year: section.year,
      semester,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    const assignmentId = `${subjectRef.id}_${dept.id}_${semester}`;
    const batch = db.batch();
    batch.set(subjectRef, subjectDoc);
    batch.set(collegeRef.collection("subjectSemesterAssignments").doc(assignmentId), assignmentDoc);
    await batch.commit();

    // The docs come back so the caller can show the subject without a refetch.
    return NextResponse.json(
      { id: subjectRef.id, subject: { id: subjectRef.id, ...subjectDoc }, assignment: { id: assignmentId, ...assignmentDoc } },
      { status: 201 },
    );
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/subjects/custom POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
