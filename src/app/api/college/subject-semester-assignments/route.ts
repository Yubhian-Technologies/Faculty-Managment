export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Maps a master Subject (courseId + regulation, department-independent)
// into a specific semester FOR ONE DEPARTMENT
// (SubjectSemesterAssignment, types/teaching.ts) - a different
// department can independently map the exact same subject into a different
// semester, since the doc id (`${subjectId}_${departmentId}`) scopes "one
// semester per subject" to just that one department.
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
      query = db.collection("colleges").doc(session.collegeId)
        .collection("subjectSemesterAssignments").where("subjectId", "==", subjectId);
    } else {
      query = db.collection("colleges").doc(session.collegeId)
        .collection("subjectSemesterAssignments").where("courseId", "==", courseId);
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

    return NextResponse.json({ assignments });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[subject-semester-assignments GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Assign a master Subject (from the subjects collection) to a specific
// semester FOR ONE DEPARTMENT (SubjectSemesterAssignment,
// types/teaching.ts). Auto-resolves courseId, academicYear, regulation,
// and year from the subject document - the caller only needs
// subjectId + departmentId + semester.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
    const body = (await request.json()) as {
      subjectId?: string;
      departmentId?: string;
      semester?: number;
      departmentName?: string;
    };
    const { subjectId, departmentId, semester, departmentName } = body;
    if (!subjectId || !departmentId || !semester) {
      return NextResponse.json(
        { error: "subjectId, departmentId and semester are required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // Auto-resolve courseId, academicYear, regulation, year from the
    // master Subject document so the caller only needs subjectId.
    const subjectSnap = await db.collection("colleges").doc(session.collegeId).collection("subjects").doc(subjectId).get();
    if (!subjectSnap.exists) {
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }
    const subject = subjectSnap.data() as { courseId?: string; academicYear?: string; regulation?: string; name?: string; code?: string; courseName?: string };
    const courseId = subject.courseId;
    const academicYear = subject.academicYear ?? "";
    const regulation = subject.regulation ?? "";
    if (!courseId) {
      return NextResponse.json({ error: "Subject has no courseId - cannot resolve assignment" }, { status: 400 });
    }

    // Use subject.academicYear to derive the ordinal year for
    // CourseYearTiming lookup. If academicYear is "2026-27", the
    // start year is 2026. The CourseYearTiming doc ID is
    // ${courseId}_year${year} where year is the ordinal (1-based).
    const yearStart = academicYear ? Number(academicYear.split("-")[0]) : undefined;
    // Derive ordinal year from the session: a subject created for
    // academicYear XXXX-XXXX corresponds to year 1 if the current
    // session matches. Fall back to the section/courseYearTiming
    // resolution below.
    const timingSnap = await collegeRef.collection("courseYearTimings").doc(`${courseId}_year1`).get();
    const configuredSemesters = timingSnap.exists
      ? (timingSnap.data() as { semesters?: { semester: number }[] } | undefined)?.semesters ?? []
      : [];
    // Try year 1 first, then year 2, etc. until we find a
    // CourseYearTiming that has the requested semester configured.
    let resolvedYear = 1;
    let foundSemesters = configuredSemesters;
    for (let y = 1; y <= 6; y++) {
      const snap = await collegeRef.collection("courseYearTimings").doc(`${courseId}_year${y}`).get();
      if (snap.exists) {
        const sems = (snap.data() as { semesters?: { semester: number }[] } | undefined)?.semesters ?? [];
        if (sems.some((s) => s.semester === Number(semester))) {
          resolvedYear = y;
          foundSemesters = sems;
          break;
        }
      }
    }
    if (foundSemesters.length === 0 || !foundSemesters.some((s) => s.semester === Number(semester))) {
      return NextResponse.json(
        { error: "That semester isn't configured for any year of this course - set it up in Course-Year Timings first" },
        { status: 400 }
      );
    }

    const now = new Date();
    const ref = collegeRef.collection("subjectSemesterAssignments").doc(`${subjectId}_${departmentId}`);
    const existing = await ref.get();
    await ref.set({
      collegeId: session.collegeId,
      subjectId,
      subjectName: subject.name ?? "",
      subjectCode: subject.code ?? "",
      courseId,
      academicYear,
      regulation,
      year: resolvedYear,
      departmentId,
      departmentName: departmentName ?? subject.courseName ?? "",
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
