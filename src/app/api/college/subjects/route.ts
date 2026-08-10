export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { SubjectType } from "@/types";
import {
  getHodDepartmentScope, canHodEditDepartment, getRelatedDepartmentNames, resolveSubjectDepartment,
} from "@/lib/departments/scope";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "EXAM_CELL", "DEAN");
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");
    const year = searchParams.get("year");
    const deptFilter = searchParams.get("department");

    const db = getAdminDb();
    let query: FirebaseFirestore.Query = db.collection("colleges").doc(session.collegeId).collection("subjects");

    if (session.role === "HOD") {
      // Viewing is bidirectional (unlike editing, which stays parent-only -
      // see canHodEditDepartment in POST below): a parent HOD sees their own
      // department's subjects and every sub-department's, AND a sub-HOD
      // (e.g. BS-Chemistry, BS-Mathematics) sees their parent's (Basic
      // Science) subjects too, since a sub-department's students are taught
      // under the parent's program/courses rather than owning their own.
      // Firestore caps `in` at 30 values, which comfortably covers a
      // department's parent + siblings.
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      const names = await getRelatedDepartmentNames(db, session.collegeId, scope.departmentName);
      if (names.length === 1) {
        query = query.where("department", "==", names[0]);
      } else if (names.length > 1) {
        query = query.where("department", "in", names.slice(0, 30));
      }
    } else if (deptFilter) {
      // Same bidirectional visibility as the HOD branch above, for Dean/
      // Principal/VP: browsing a fed department (e.g. IT) also shows its
      // feeder's subjects (e.g. Basic Science's shared 1st-year catalog) -
      // the `year` filter below keeps a feeder's subjects from leaking into
      // a year it doesn't own.
      const names = await getRelatedDepartmentNames(db, session.collegeId, deptFilter);
      query = names.length > 1
        ? query.where("department", "in", names.slice(0, 30))
        : query.where("department", "==", deptFilter);
    }

    if (courseId) query = query.where("courseId", "==", courseId);
    if (year) query = query.where("year", "==", Number(year));

    const snap = await query.get();
    const subjects = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? ""));

    return NextResponse.json({ subjects });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/subjects GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Two independent creation shapes share this collection: course/year-scoped subjects
// (HOD Subjects page - courseId + year, validated against the course) and
// semester-scoped subjects (HOD Teaching Assignments page - semester + department,
// no course link). Branch on which fields the caller sent.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "DEAN");
    const body = (await request.json()) as {
      courseId?: string;
      year?: number;
      semester?: number;
      name: string;
      code: string;
      hoursPerWeek?: number;
      totalHoursPerSemester?: number;
      credits?: number;
      type?: SubjectType;
      department?: string;
    };

    if (!body.name?.trim() || !body.code?.trim()) {
      return NextResponse.json({ error: "name and code are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();

    if (body.courseId) {
      const { courseId, year } = body;
      if (!year) {
        return NextResponse.json({ error: "courseId, year, name and code are required" }, { status: 400 });
      }

      const courseSnap = await db.collection("colleges").doc(session.collegeId).collection("courses").doc(courseId).get();
      if (!courseSnap.exists) return NextResponse.json({ error: "Course not found" }, { status: 404 });
      const course = courseSnap.data() as { name: string; departmentId: string; durationYears: number };
      if (year < 1 || year > course.durationYears) {
        return NextResponse.json({ error: `Year must be between 1 and ${course.durationYears} for ${course.name}` }, { status: 400 });
      }

      let dept = "";
      if (session.role === "HOD") {
        // A parent HOD may file the subject under their own department or any
        // sub-department; body.department names which. A sub-HOD has no children,
        // so this collapses to their own department either way.
        const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
        dept = body.department?.trim() || scope.departmentName;
        if (!canHodEditDepartment(scope, dept)) {
          return NextResponse.json(
            { error: "That department is not yours or one of your sub-departments" },
            { status: 403 },
          );
        }
        // A sub-department borrows its parent's courses (it never has its own),
        // so the course may belong to the target department itself or its parent.
        const deptSnap = await db.collection("colleges").doc(session.collegeId).collection("departments")
          .where("name", "==", dept).limit(1).get();
        const deptDoc = deptSnap.empty ? null : (deptSnap.docs[0].data() as { parentDepartmentId?: string });
        const deptId = deptSnap.empty ? null : deptSnap.docs[0].id;
        const ownsDirectly = deptId === course.departmentId;
        const ownsViaParent = !!deptDoc?.parentDepartmentId && deptDoc.parentDepartmentId === course.departmentId;
        if (!ownsDirectly && !ownsViaParent) {
          return NextResponse.json({ error: "Course does not belong to your department" }, { status: 403 });
        }
      } else {
        // Non-HOD callers (Principal/VP/Super Admin/Dean) aren't scoped to one
        // department, so the client may name which one it's targeting - but
        // only the course's own department or one of the departments it feeds
        // (Department.secondaryDepartments) is accepted, so it can never drift
        // to an unrelated department.
        const courseDeptSnap = await db.collection("colleges").doc(session.collegeId)
          .collection("departments").doc(course.departmentId).get();
        const courseDept = courseDeptSnap.data() as { name?: string; secondaryDepartments?: string[] } | undefined;
        const courseDeptName = courseDept?.name ?? "";
        const requestedDept = body.department?.trim() || courseDeptName;
        if (requestedDept !== courseDeptName && !(courseDept?.secondaryDepartments ?? []).includes(requestedDept)) {
          return NextResponse.json({ error: "That department doesn't offer this course" }, { status: 403 });
        }
        // A fed department's reserved year (e.g. any secondary department's
        // 1st year, when Basic Science reserves year 1 via assignedYears)
        // files under the feeder instead, so every fed department reads from
        // one shared 1st-year list; other years (2nd year onward) stay filed
        // under the department actually selected (IT for IT, CS for CS, ...).
        dept = await resolveSubjectDepartment(db, session.collegeId, requestedDept, Number(year));
      }

      const ref = await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("subjects")
        .add({
          collegeId: session.collegeId,
          department: dept,
          departmentId: course.departmentId,
          courseId,
          courseName: course.name,
          year: Number(year),
          name: body.name.trim(),
          code: body.code.toUpperCase().trim(),
          hoursPerWeek: body.hoursPerWeek != null ? Number(body.hoursPerWeek) : 0,
          totalHoursPerSemester: body.totalHoursPerSemester != null ? Number(body.totalHoursPerSemester) : null,
          credits: body.credits != null ? Number(body.credits) : 0,
          type: body.type ?? "THEORY",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });

      return NextResponse.json({ id: ref.id }, { status: 201 });
    }

    if (!body.semester) {
      return NextResponse.json({ error: "name, code, semester are required" }, { status: 400 });
    }

    let department = body.department ?? "";
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      department = body.department?.trim() || scope.departmentName;
      if (!canHodEditDepartment(scope, department)) {
        return NextResponse.json(
          { error: "That department is not yours or one of your sub-departments" },
          { status: 403 },
        );
      }
    }

    if (!department) {
      return NextResponse.json({ error: "department is required" }, { status: 400 });
    }

    const ref = await db.collection("colleges").doc(session.collegeId).collection("subjects").add({
      collegeId: session.collegeId,
      department,
      name: body.name.trim(),
      code: body.code.trim().toUpperCase(),
      semester: Number(body.semester),
      hoursPerWeek: Number(body.hoursPerWeek) || 0,
      credits: Number(body.credits) || 0,
      type: body.type ?? "THEORY",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/subjects POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
