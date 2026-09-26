export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Maps a master Subject (catalogId + year, department-independent - see
// Subject.catalogId's own doc-comment) into a specific semester FOR ONE
// DEPARTMENT (SubjectSemesterAssignment, types/teaching.ts) - a different
// department can independently map the exact same subject into a different
// semester, since the doc id (`${subjectId}_${departmentId}`) scopes "one
// semester per subject" to just that one department.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS", "PANEL_MEMBER", "COLLEGE_STAFF"
    );
    const { searchParams } = new URL(request.url);
    const catalogId = searchParams.get("catalogId");
    const year = searchParams.get("year");
    const departmentId = searchParams.get("departmentId");
    const semester = searchParams.get("semester");

    if (!catalogId || !year) {
      return NextResponse.json({ error: "catalogId and year are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

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

    let query: FirebaseFirestore.Query = db
      .collection("colleges").doc(session.collegeId)
      .collection("subjectSemesterAssignments")
      .where("catalogId", "==", catalogId)
      .where("year", "==", Number(year));
    if (targetDeptIds) {
      query = query.where("departmentId", "in", targetDeptIds.slice(0, 10));
    } else if (departmentId) {
      query = query.where("departmentId", "==", departmentId);
    }
    if (semester) query = query.where("semester", "==", Number(semester));

    const snap = await query.get();
    const assignments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ assignments });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[subject-semester-assignments GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Upsert (not add) - same course/year-scoped-subject-creation role restriction
// as POST /api/college/subjects (Academics/Principal/VP/Super Admin; HOD
// manages the unrelated semester-scoped shape instead).
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
    const body = (await request.json()) as {
      subjectId?: string;
      subjectName?: string;
      subjectCode?: string;
      catalogId?: string;
      year?: number;
      departmentId?: string;
      departmentName?: string;
      courseId?: string;
      semester?: number;
    };
    const { subjectId, subjectName, subjectCode, catalogId, year, departmentId, departmentName, courseId, semester } = body;
    if (!subjectId || !catalogId || !year || !departmentId || !courseId || !semester) {
      return NextResponse.json(
        { error: "subjectId, catalogId, year, departmentId, courseId and semester are required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // Validate against THIS department's own CourseYearTiming - the same
    // course-year could resolve to a different semester count for a
    // different department's copy of the course.
    const timingSnap = await collegeRef.collection("courseYearTimings").doc(`${courseId}_year${year}`).get();
    const configuredSemesters = (timingSnap.data() as { semesters?: { semester: number }[] } | undefined)?.semesters ?? [];
    if (!configuredSemesters.some((s) => s.semester === Number(semester))) {
      return NextResponse.json(
        { error: "That semester isn't configured for this department's course-year - set it up in Course-Year Timings first" },
        { status: 400 }
      );
    }

    const now = new Date();
    const ref = collegeRef.collection("subjectSemesterAssignments").doc(`${subjectId}_${departmentId}`);
    const existing = await ref.get();
    await ref.set({
      collegeId: session.collegeId,
      subjectId,
      subjectName: subjectName ?? "",
      subjectCode: subjectCode ?? "",
      catalogId,
      year: Number(year),
      departmentId,
      departmentName: departmentName ?? "",
      courseId,
      semester: Number(semester),
      createdAt: existing.exists ? (existing.data() as { createdAt?: unknown }).createdAt : now,
      updatedAt: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[subject-semester-assignments POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Unassign - one subject from one department's semester mapping. Every other
// department's own row for the same subject is untouched.
export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
    const { searchParams } = new URL(request.url);
    const subjectId = searchParams.get("subjectId");
    const departmentId = searchParams.get("departmentId");
    if (!subjectId || !departmentId) {
      return NextResponse.json({ error: "subjectId and departmentId are required" }, { status: 400 });
    }

    const db = getAdminDb();
    await db
      .collection("colleges").doc(session.collegeId)
      .collection("subjectSemesterAssignments").doc(`${subjectId}_${departmentId}`)
      .delete();

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[subject-semester-assignments DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
