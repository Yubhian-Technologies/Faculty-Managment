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
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF", "ACADEMICS");
    // Added for a DEPARTMENT (+ year + semester), not for any one section: every
    // section of that department then picks it from the normal Subject list.
    const body = (await readJsonBody(request)) as {
      courseId?: string;
      departmentId?: string;
      year?: number;
      semester?: number;
      name?: string;
      code?: string;
      shortCode?: string;
      type?: string;
      isNonTeachingLoad?: boolean;
    };
    const name = body.name?.trim() ?? "";
    const semester = Number(body.semester);
    const yearNum = Number(body.year);
    if (!body.courseId || !body.departmentId || !name || !Number.isInteger(yearNum) || yearNum < 1 || !Number.isInteger(semester) || semester < 1) {
      return NextResponse.json({ error: "courseId, departmentId, year, semester and a subject name are required" }, { status: 400 });
    }
    if (name.length > 80) return NextResponse.json({ error: "Subject name is too long" }, { status: 400 });

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const [courseSnap, deptsSnap] = await Promise.all([
      collegeRef.collection("courses").doc(body.courseId).get(),
      collegeRef.collection("departments").get(),
    ]);
    if (!courseSnap.exists) return NextResponse.json({ error: "Course not found" }, { status: 404 });
    const course = courseSnap.data() as { name: string; catalogId?: string };
    const allDepartments = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as (DepartmentYearRow & Pick<Department, "name">)[];
    const dept = allDepartments.find((d) => d.id === body.departmentId);
    if (!dept) return NextResponse.json({ error: "Department not found" }, { status: 404 });
    // What the rest of this handler reads: the department's name and the year.
    const section = { year: yearNum, department: dept.name };

    // Same scope rules as staffing a section of that department (teaching-assignments POST).
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartmentYear(scope, allDepartments, section.department, section.year, course.catalogId)) {
        return NextResponse.json({ error: "That department is not yours, one of your sub-departments, or a year your department manages" }, { status: 403 });
      }
    } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      if (!(await isTimetableIncharge(db, session.collegeId, session.uid, body.courseId, section.year))) {
        return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
      }
    }

    // One subject per department + year + semester + name, shared by every
    // section of that department (they all pick it from the normal subject
    // list) - typing "NSS" from a second section reuses the first, it never
    // makes a duplicate. Legacy ones (random ids) are found by name; new ones
    // get a deterministic id so two simultaneous adds land on the same doc.
    const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const nameKey = norm(name);
    if (!nameKey) return NextResponse.json({ error: "Enter a subject name" }, { status: 400 });
    const existingRows = await collegeRef.collection("subjectSemesterAssignments").where("departmentId", "==", dept.id).get();
    const found = existingRows.docs.find((d) => {
      const x = d.data() as { isCustom?: boolean; semester?: number; year?: number; subjectName?: string };
      return x.isCustom && x.semester === semester && x.year === section.year && norm(x.subjectName ?? "") === nameKey;
    });
    if (found) {
      const subjSnap = await collegeRef.collection("subjects").doc((found.data() as { subjectId: string }).subjectId).get();
      return NextResponse.json({
        id: subjSnap.id, existing: true,
        subject: { id: subjSnap.id, ...subjSnap.data() },
        assignment: { id: found.id, ...found.data() },
      });
    }

    const now = new Date();
    const subjectRef = collegeRef.collection("subjects").doc(`cus_${dept.id}_${section.year}_${semester}_${nameKey}`.slice(0, 200));
    const code = (body.code ?? body.shortCode ?? name).trim().toUpperCase();
    const shortCode = (body.shortCode ?? body.code ?? name).trim().toUpperCase();
    const isNonTeaching = body.type === "NON_TEACHING" || body.isNonTeachingLoad === true;
    const type = isNonTeaching ? "NON_TEACHING" : (body.type ?? "THEORY");
    
    const base = {
      collegeId: session.collegeId,
      courseId: body.courseId,
      courseName: course.name,
      name,
      code,
      shortCode,
      type,
      hoursPerWeek: 0,
      credits: 0,
      isCustom: true,
      ...(isNonTeaching ? { isNonTeachingLoad: true, excludeFromResume: true } : {}),
    };
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
    const assignmentRef = collegeRef.collection("subjectSemesterAssignments").doc(assignmentId);
    const raced = await db.runTransaction(async (tx) => {
      if ((await tx.get(assignmentRef)).exists) return true; // another add got here first
      tx.set(subjectRef, subjectDoc);
      tx.set(assignmentRef, assignmentDoc);
      return false;
    });
    if (raced) {
      const [s, a] = await Promise.all([subjectRef.get(), assignmentRef.get()]);
      return NextResponse.json({ id: s.id, existing: true, subject: { id: s.id, ...s.data() }, assignment: { id: a.id, ...a.data() } });
    }

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
