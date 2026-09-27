export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartmentId } from "@/lib/departments/scope";
import { SubjectInstanceService } from "@/lib/subjects/services/SubjectInstanceService";

// Maps a master Subject (courseId + regulation, department-independent)
// into a specific semester FOR ONE DEPARTMENT as a concrete Subject Instance
// (SubjectSemesterAssignment, types/teaching.ts).
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS", "PANEL_MEMBER", "COLLEGE_STAFF"
    );
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");
    const academicYear = searchParams.get("academicYear");
    const subjectId = searchParams.get("subjectId");
    const departmentId = searchParams.get("departmentId");
    const semester = searchParams.get("semester");
    const year = searchParams.get("year");

    // Need at least courseId or subjectId to narrow the query
    if (!courseId && !subjectId) {
      return NextResponse.json({ error: "courseId or subjectId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // An HOD may only see their own department's (or a sub-department's/
    // managed branch's) mappings - never an arbitrary department's, which an
    // unfiltered departmentId/no-departmentId query would otherwise return.
    // Was previously unchecked entirely, unlike every sibling route in this
    // file tree (subjects/[id], teaching-assignments).
    let hodScope: Awaited<ReturnType<typeof getHodDepartmentScope>> | null = null;
    if (session.role === "HOD") {
      hodScope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (departmentId && !canHodEditDepartmentId(hodScope, departmentId)) {
        return NextResponse.json({ error: "That department is not yours or one of your sub-departments" }, { status: 403 });
      }
    }

    // If a departmentId is provided, also include assignments for any
    // child sub-departments (e.g. selecting "Basic Science" shows
    // assignments for BS-Chemistry, BS-Mathematics, etc.).
    let targetDeptIds: string[] | null = null;
    if (departmentId) {
      const deptSnap = await collegeRef.collection("departments").doc(departmentId).get();
      const dept = deptSnap.data() as { parentDepartmentId?: string; hasSubDepartments?: boolean } | undefined;
      const deptIds = new Set([departmentId]);
      if (dept?.hasSubDepartments) {
        const childrenSnap = await collegeRef.collection("departments")
          .where("parentDepartmentId", "==", departmentId).get();
        for (const d of childrenSnap.docs) deptIds.add(d.id);
      }
      targetDeptIds = Array.from(deptIds);
    }

    let query: FirebaseFirestore.Query;

    // Single-field equality query to avoid Firestore composite index requirements
    if (subjectId) {
      query = collegeRef.collection("subjectSemesterAssignments").where("subjectId", "==", subjectId);
    } else {
      query = collegeRef.collection("subjectSemesterAssignments").where("courseId", "==", courseId);
    }

    const snap = await query.get();
    let assignments = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, any>));

    if (academicYear) {
      assignments = assignments.filter((a) => !a.academicYear || a.academicYear === academicYear);
    }
    if (targetDeptIds && targetDeptIds.length > 0) {
      const set = new Set(targetDeptIds);
      assignments = assignments.filter((a) => a.departmentId && set.has(String(a.departmentId)));
    } else if (departmentId) {
      assignments = assignments.filter((a) => a.departmentId === departmentId);
    }
    if (semester != null) {
      const semNum = Number(semester);
      assignments = assignments.filter((a) => a.semester === semNum);
    }
    if (year != null) {
      const yearNum = Number(year);
      assignments = assignments.filter((a) => a.year == null || a.year === yearNum);
    }
    // No explicit departmentId (already validated above when present) - an
    // HOD's courseId/subjectId-only query must still never surface another
    // department's mapping.
    if (hodScope && !departmentId) {
      assignments = assignments.filter((a) => canHodEditDepartmentId(hodScope!, String(a.departmentId ?? "")));
    }

    return NextResponse.json({ assignments });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[subject-semester-assignments GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Assigns and instantiates a Master Subject (from the subjects collection)
// as a concrete snapshot copy for a Department + Course + Year + Semester.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS", "HOD");
    const body = (await request.json()) as {
      subjectId?: string;
      subjectIds?: string[];
      departmentId?: string;
      semester?: number;
      departmentName?: string;
      year?: number;
      customOverrides?: {
        lectureHours?: number;
        tutorialHours?: number;
        practicalHours?: number;
        credits?: number;
      };
    };

    const { subjectId, subjectIds, departmentId, semester, departmentName, year, customOverrides } = body;
    if (!departmentId || semester == null) {
      return NextResponse.json(
        { error: "departmentId and semester are required" },
        { status: 400 }
      );
    }

    if (session.role === "HOD") {
      const db = getAdminDb();
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartmentId(scope, departmentId)) {
        return NextResponse.json({ error: "That department is not yours or one of your sub-departments" }, { status: 403 });
      }
    }

    const service = new SubjectInstanceService();

    // Bulk instantiation support
    if (Array.isArray(subjectIds) && subjectIds.length > 0) {
      const result = await service.bulkAssignSubjectInstances({
        collegeId: session.collegeId,
        subjectIds,
        departmentId,
        semester: Number(semester),
        departmentName,
        year: year ? Number(year) : undefined,
      });
      return NextResponse.json(result, { status: 201 });
    }

    if (!subjectId) {
      return NextResponse.json(
        { error: "subjectId or subjectIds is required" },
        { status: 400 }
      );
    }

    const result = await service.assignSubjectInstance({
      collegeId: session.collegeId,
      subjectId,
      departmentId,
      semester: Number(semester),
      departmentName,
      year: year ? Number(year) : undefined,
      customOverrides,
    });

    return NextResponse.json({ id: result.id, instance: result.instance }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[subject-semester-assignments POST]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
  }
}

// Unassign - removes one subject instance from one department's semester mapping.
export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS", "HOD");
    const { searchParams } = new URL(request.url);
    const subjectId = searchParams.get("subjectId");
    const departmentId = searchParams.get("departmentId");
    if (!subjectId || !departmentId) {
      return NextResponse.json({ error: "subjectId and departmentId are required" }, { status: 400 });
    }

    if (session.role === "HOD") {
      const db = getAdminDb();
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartmentId(scope, departmentId)) {
        return NextResponse.json({ error: "That department is not yours or one of your sub-departments" }, { status: 403 });
      }
    }

    const service = new SubjectInstanceService();
    await service.unassignSubjectInstance(session.collegeId, subjectId, departmentId);

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[subject-semester-assignments DELETE]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
  }
}
