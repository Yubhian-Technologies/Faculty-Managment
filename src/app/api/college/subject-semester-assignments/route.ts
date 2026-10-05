export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
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
    let assignments = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>));

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
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
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
    // HOD is deliberately not in this list: curriculum assignment belongs to
    // Academics/Principal, and the HOD Subjects page is read-only. No client in
    // the app calls this write path as an HOD (every caller only GETs, above).
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
    const body = (await readJsonBody(request)) as {
      subjectId?: string;
      subjectIds?: string[];
      departmentId?: string;
      semester?: number;
      departmentName?: string;
      year?: number;
      courseId?: string;
      customOverrides?: {
        lectureHours?: number;
        tutorialHours?: number;
        practicalHours?: number;
        credits?: number;
      };
    };

    const { subjectId, subjectIds, departmentId, semester, departmentName, year, courseId, customOverrides } = body;
    if (!departmentId || semester == null) {
      return NextResponse.json(
        { error: "departmentId and semester are required" },
        { status: 400 }
      );
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
        courseId,
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
      courseId,
      customOverrides,
    });

    return NextResponse.json({ id: result.id, instance: result.instance }, { status: 201 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[subject-semester-assignments POST]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to assign subject" }, { status: 400 });
  }
}

// Edits one instance's hours/credits (a department-level override of the master).
export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
    const body = (await readJsonBody(request)) as {
      id?: string;
      lectureHours?: number;
      tutorialHours?: number;
      practicalHours?: number;
      credits?: number;
    };
    if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const nums = { lectureHours: body.lectureHours, tutorialHours: body.tutorialHours, practicalHours: body.practicalHours, credits: body.credits };
    for (const [k, v] of Object.entries(nums)) {
      if (v !== undefined && (!Number.isFinite(Number(v)) || Number(v) < 0)) {
        return NextResponse.json({ error: `${k} must be a non-negative number` }, { status: 400 });
      }
    }

    const ref = getAdminDb().collection("colleges").doc(session.collegeId).collection("subjectSemesterAssignments").doc(body.id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const cur = snap.data() as { lectureHours?: number; tutorialHours?: number; practicalHours?: number };

    const lectureHours = body.lectureHours !== undefined ? Number(body.lectureHours) : cur.lectureHours ?? 0;
    const tutorialHours = body.tutorialHours !== undefined ? Number(body.tutorialHours) : cur.tutorialHours ?? 0;
    const practicalHours = body.practicalHours !== undefined ? Number(body.practicalHours) : cur.practicalHours ?? 0;
    await ref.update({
      lectureHours,
      tutorialHours,
      practicalHours,
      hoursPerWeek: lectureHours + tutorialHours + practicalHours,
      ...(body.credits !== undefined ? { credits: Number(body.credits) } : {}),
      isCustomized: true,
      updatedAt: new Date(),
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[subject-semester-assignments PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Unassign - removes one subject instance from one department's semester mapping.
export async function DELETE(request: Request) {
  try {
    // HOD is deliberately not in this list: curriculum assignment belongs to
    // Academics/Principal, and the HOD Subjects page is read-only. No client in
    // the app calls this write path as an HOD (every caller only GETs, above).
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
    const { searchParams } = new URL(request.url);
    const subjectId = searchParams.get("subjectId");
    const departmentId = searchParams.get("departmentId");
    const semesterParam = searchParams.get("semester");
    if (!subjectId || !departmentId || semesterParam == null) {
      return NextResponse.json({ error: "subjectId, departmentId and semester are required" }, { status: 400 });
    }
    const semester = Number(semesterParam);

    const service = new SubjectInstanceService();
    await service.unassignSubjectInstance(session.collegeId, subjectId, departmentId, semester);

    return NextResponse.json({ success: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && err.message.includes("active faculty teaching assignments")) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[subject-semester-assignments DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
