export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { examConfigId } from "@/lib/exams/internalExamMarks";
import { resolveDepartmentCourseScope } from "@/lib/college/academicStructure";
import type { DepartmentCourseScope, ExamConfigComponent, ExamConfiguration, Subject } from "@/types";

// Broad read access — same role set already used for /api/college/subjects —
// so the Exam Cell dashboard, Principal/HOD oversight, and the Faculty
// Dashboard's Internal Exam module (which needs to read the config live) can
// all fetch this.
const READ_ROLES = ["EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "PANEL_MEMBER"];

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...READ_ROLES);
    const { searchParams } = new URL(request.url);
    const subjectId = searchParams.get("subjectId");
    const courseId = searchParams.get("courseId");
    const year = searchParams.get("year");

    const db = getAdminDb();
    const coll = db.collection("colleges").doc(session.collegeId).collection("examConfigurations");

    // Convenience mode for callers that only know the subject (Faculty/HOD/
    // Principal's Internal Exam views) — resolve it to the course+year the
    // subject belongs to, then return that shared branch-level config. A
    // semester-scoped subject (no courseId/year) has no branch-level config
    // to resolve to, same as before this doc-id change.
    if (subjectId) {
      const subjSnap = await db.collection("colleges").doc(session.collegeId).collection("subjects").doc(subjectId).get();
      const subject = subjSnap.exists ? (subjSnap.data() as Subject) : null;
      if (!subject?.courseId || subject.year == null) {
        return NextResponse.json({ configuration: null });
      }
      const snap = await coll.doc(examConfigId(subject.courseId, subject.year)).get();
      return NextResponse.json({ configuration: snap.exists ? { id: snap.id, ...snap.data() } : null });
    }

    if (courseId && year) {
      const snap = await coll.doc(examConfigId(courseId, Number(year))).get();
      return NextResponse.json({ configuration: snap.exists ? { id: snap.id, ...snap.data() } : null });
    }

    let query: FirebaseFirestore.Query = coll;
    if (courseId) query = query.where("courseId", "==", courseId);
    if (year) query = query.where("year", "==", Number(year));

    const snap = await query.get();
    const configurations = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ac = a as { courseName?: string; department?: string; year?: number };
        const bc = b as { courseName?: string; department?: string; year?: number };
        return (
          (ac.courseName ?? "").localeCompare(bc.courseName ?? "") ||
          (ac.department ?? "").localeCompare(bc.department ?? "") ||
          (ac.year ?? 0) - (bc.year ?? 0)
        );
      });

    return NextResponse.json({ configurations });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-configurations GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Upsert — the document id is always `${courseId}_year${year}` (one
// configuration per course+year, i.e. per branch since courseId already
// pins the department), so re-saving the same course+year edits its existing
// configuration instead of creating a duplicate, and it automatically covers
// every subject taught under that course+year.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      courseId?: string;
      courseName?: string;
      department?: string;
      year?: number;
      internalMaxMarks?: number;
      externalMaxMarks?: number;
      components?: (Omit<ExamConfigComponent, "id"> & { id?: string })[];
      status?: "ACTIVE" | "INACTIVE";
    };

    const {
      courseId, courseName, department, year,
      internalMaxMarks, externalMaxMarks, components, status,
    } = body;

    if (!courseId || !department || !year) {
      return NextResponse.json({ error: "courseId, department and year are required" }, { status: 400 });
    }

    const db = getAdminDb();

    // The course+year combo must actually exist for a department that runs
    // it - resolveDepartmentCourseScope (per-course override included), never
    // a raw 1..durationYears span. Previously unchecked: Exam Cell could
    // create a configuration for a Course+Year+Department a department never
    // actually teaches (e.g. Basic Science, Year 3, on a shared 4-year
    // B.Tech course it only opens Year 1 of).
    const courseSnap = await db.collection("colleges").doc(session.collegeId).collection("courses").doc(courseId).get();
    if (!courseSnap.exists) return NextResponse.json({ error: "Course not found" }, { status: 404 });
    const course = courseSnap.data() as { departmentId?: string; catalogId?: string; durationYears?: number };
    if (course.durationYears != null && (year < 1 || year > course.durationYears)) {
      return NextResponse.json({ error: `Year must be between 1 and ${course.durationYears}` }, { status: 400 });
    }
    if (course.departmentId) {
      const deptSnap = await db.collection("colleges").doc(session.collegeId).collection("departments").doc(course.departmentId).get();
      if (deptSnap.exists) {
        const deptDoc = deptSnap.data() as { assignedYears?: number[]; secondaryDepartments?: string[]; courseScopes?: Record<string, DepartmentCourseScope> };
        const assignedYears = resolveDepartmentCourseScope(deptDoc, course.catalogId).assignedYears;
        if (assignedYears.length > 0 && !assignedYears.includes(Number(year))) {
          return NextResponse.json({ error: `"${department}" is not assigned to teach Year ${year}` }, { status: 400 });
        }
      }
    }

    if (typeof internalMaxMarks !== "number" || internalMaxMarks <= 0) {
      return NextResponse.json({ error: "Internal Maximum Marks must be a positive number" }, { status: 400 });
    }
    if (typeof externalMaxMarks !== "number" || externalMaxMarks < 0) {
      return NextResponse.json({ error: "External Maximum Marks must be a non-negative number" }, { status: 400 });
    }
    if (!Array.isArray(components) || components.length === 0) {
      return NextResponse.json({ error: "At least one internal marks component is required" }, { status: 400 });
    }
    for (const c of components) {
      if (!c.name?.trim()) {
        return NextResponse.json({ error: "Every component needs a name" }, { status: 400 });
      }
      if (typeof c.maxMarks !== "number" || c.maxMarks <= 0) {
        return NextResponse.json({ error: `"${c.name}" needs a positive maximum marks value` }, { status: 400 });
      }
    }
    const activeTotal = components.filter((c) => c.isActive !== false).reduce((sum, c) => sum + c.maxMarks, 0);
    if (activeTotal !== internalMaxMarks) {
      return NextResponse.json(
        { error: `Breakdown total must equal the Internal Maximum Marks (${internalMaxMarks}). Current total: ${activeTotal}.` },
        { status: 400 }
      );
    }

    // requireCollegeMember only decodes the session cookie (uid/role/collegeId) —
    // the actor's display name lives in their Firestore user record.
    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Exam Cell";

    const id = examConfigId(courseId, year);
    const ref = db.collection("colleges").doc(session.collegeId).collection("examConfigurations").doc(id);
    const existingSnap = await ref.get();
    const existing = existingSnap.exists ? (existingSnap.data() as ExamConfiguration) : null;
    const now = new Date();

    const normalizedComponents: ExamConfigComponent[] = components.map((c, i) => ({
      id: c.id || `c${i}_${Date.now().toString(36)}`,
      name: c.name.trim(),
      maxMarks: c.maxMarks,
      ...(c.description?.trim() ? { description: c.description.trim() } : {}),
      order: c.order ?? i,
      isActive: c.isActive !== false,
    }));

    // Written via .set() with a plain object (not typed against ExamConfiguration)
    // since createdAt/updatedAt are a native Date here — the Admin SDK converts
    // it to a Firestore Timestamp on write, matching every other route's convention.
    const data = {
      collegeId: session.collegeId,
      courseId,
      courseName: courseName ?? "",
      department,
      year,
      internalMaxMarks,
      externalMaxMarks,
      components: normalizedComponents,
      status: status ?? "ACTIVE",
      createdBy: existing?.createdBy ?? session.uid,
      createdByName: existing?.createdByName ?? actorName,
      updatedBy: session.uid,
      updatedByName: actorName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await ref.set(data);

    return NextResponse.json({ configuration: { id, ...data } }, { status: existing ? 200 : 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-configurations POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
