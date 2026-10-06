export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartmentId } from "@/lib/departments/scope";
import { SubjectInstanceService, teachingAssignmentUsesInstance } from "@/lib/subjects/services/SubjectInstanceService";
import { cachedCollectionDocs } from "@/lib/firestore/sharedReads";
import { getInChunks } from "@/lib/firestore/inQuery";
import type { Course, Department, TeachingAssignment } from "@/types";

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
      // Subject-level fields already saved on the master subject (PATCH
      // subjects/[id]); mirrored onto every assignment row of that subject so
      // the Academics table, which reads these copies, doesn't show stale values.
      snapshot?: {
        subjectName?: string;
        subjectCode?: string;
        shortCode?: string;
        category?: string;
        customCategory?: string | null;
        type?: string;
        serialNumber?: number;
        totalHoursPerSemester?: number | null;
      };
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
    const cur = snap.data() as {
      subjectId: string; departmentId?: string; semester: number; year?: number;
      lectureHours?: number; tutorialHours?: number; practicalHours?: number;
    };

    const lectureHours = body.lectureHours !== undefined ? Number(body.lectureHours) : cur.lectureHours ?? 0;
    const tutorialHours = body.tutorialHours !== undefined ? Number(body.tutorialHours) : cur.tutorialHours ?? 0;
    const practicalHours = body.practicalHours !== undefined ? Number(body.practicalHours) : cur.practicalHours ?? 0;
    const hoursPerWeek = lectureHours + tutorialHours + practicalHours;

    // Teaching assignments copy hoursPerWeek (it caps their timetable periods),
    // so keep the ones relying on this instance in step - but never below the
    // periods already placed, which would leave a timetable over its own cap.
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const [taSnap, deptDocs, courseDocs] = await Promise.all([
      collegeRef.collection("teachingAssignments").where("subjectId", "==", cur.subjectId).get(),
      cachedCollectionDocs(db, session.collegeId, "departments"),
      cachedCollectionDocs(db, session.collegeId, "courses"),
    ]);
    const departments = deptDocs.map((d) => ({ id: d.id, ...d.data() })) as (Department & { id: string })[];
    const coursesById = new Map(courseDocs.map((d) => [d.id, d.data() as Pick<Course, "departmentId" | "catalogId">]));
    const stale = taSnap.docs.filter((d) => {
      const ta = d.data() as TeachingAssignment;
      return ta.hoursPerWeek !== hoursPerWeek && !!cur.departmentId
        && teachingAssignmentUsesInstance(ta, { departmentId: cur.departmentId, semester: cur.semester, year: cur.year }, departments, coursesById);
    });
    if (stale.length > 0) {
      const slotDocs = await getInChunks(stale.map((d) => d.id), (chunk) => collegeRef.collection("timetableSlots").where("assignmentId", "in", chunk));
      const placed = new Map<string, number>();
      for (const s of slotDocs) {
        const id = (s.data() as { assignmentId: string }).assignmentId;
        placed.set(id, (placed.get(id) ?? 0) + 1);
      }
      const over = stale.filter((d) => (placed.get(d.id) ?? 0) > hoursPerWeek);
      if (over.length > 0) {
        const who = over.slice(0, 3).map((d) => { const t = d.data() as TeachingAssignment; return `${t.facultyName} (${t.sectionName ?? "-"}, ${placed.get(d.id)} periods)`; }).join("; ");
        return NextResponse.json({ error: `Can't lower hours below the periods already placed on the timetable: ${who}. Remove those periods first.` }, { status: 409 });
      }
    }

    await ref.update({
      lectureHours,
      tutorialHours,
      practicalHours,
      hoursPerWeek,
      ...(body.credits !== undefined ? { credits: Number(body.credits) } : {}),
      isCustomized: true,
      updatedAt: new Date(),
    });
    for (let i = 0; i < stale.length; i += 400) {
      const batch = db.batch();
      for (const d of stale.slice(i, i + 400)) batch.update(d.ref, { hoursPerWeek, updatedAt: new Date() });
      await batch.commit();
    }

    const snap2 = body.snapshot;
    if (snap2) {
      const fields: Record<string, unknown> = {};
      if (snap2.subjectName != null) fields.subjectName = String(snap2.subjectName).trim();
      if (snap2.subjectCode != null) fields.subjectCode = String(snap2.subjectCode).toUpperCase().trim();
      if (snap2.shortCode != null) fields.shortCode = String(snap2.shortCode).trim().toUpperCase();
      if (snap2.category != null) fields.category = snap2.category;
      if ("customCategory" in snap2) fields.customCategory = snap2.customCategory ?? null;
      if (snap2.type != null) fields.type = snap2.type;
      if (snap2.serialNumber != null) fields.serialNumber = Number(snap2.serialNumber);
      if ("totalHoursPerSemester" in snap2) fields.totalHoursPerSemester = snap2.totalHoursPerSemester ?? null;
      if (Object.keys(fields).length > 0) {
        const rows = await collegeRef.collection("subjectSemesterAssignments").where("subjectId", "==", cur.subjectId).get();
        for (let i = 0; i < rows.docs.length; i += 400) {
          const batch = db.batch();
          for (const d of rows.docs.slice(i, i + 400)) batch.update(d.ref, { ...fields, updatedAt: new Date() });
          await batch.commit();
        }
      }
    }
    return NextResponse.json({ success: true, teachingAssignmentsUpdated: stale.length });
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

// Unassign - removes subject instance, or hard deletes subject & all references everywhere if hardDelete=true.
export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
    const { searchParams } = new URL(request.url);
    const subjectId = searchParams.get("subjectId");
    const departmentId = searchParams.get("departmentId");
    const semesterParam = searchParams.get("semester");
    const hardDelete = searchParams.get("hardDelete") === "true";

    if (!subjectId) {
      return NextResponse.json({ error: "subjectId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    if (hardDelete) {
      // Hard delete everywhere: timetable slots, teaching assignments, subject instance assignments, master subject doc
      const [slotsSnap, assignmentsSnap, instancesSnap] = await Promise.all([
        collegeRef.collection("timetableSlots").where("subjectId", "==", subjectId).get(),
        collegeRef.collection("teachingAssignments").where("subjectId", "==", subjectId).get(),
        collegeRef.collection("subjectSemesterAssignments").where("subjectId", "==", subjectId).get(),
      ]);

      // 1. Delete timetable slots
      for (let i = 0; i < slotsSnap.docs.length; i += 400) {
        const batch = db.batch();
        for (const doc of slotsSnap.docs.slice(i, i + 400)) batch.delete(doc.ref);
        await batch.commit();
      }

      // 2. Delete teaching assignments
      for (let i = 0; i < assignmentsSnap.docs.length; i += 400) {
        const batch = db.batch();
        for (const doc of assignmentsSnap.docs.slice(i, i + 400)) batch.delete(doc.ref);
        await batch.commit();
      }

      // 3. Delete subject semester assignments
      for (let i = 0; i < instancesSnap.docs.length; i += 400) {
        const batch = db.batch();
        for (const doc of instancesSnap.docs.slice(i, i + 400)) batch.delete(doc.ref);
        await batch.commit();
      }

      // 4. Delete master subject document
      await collegeRef.collection("subjects").doc(subjectId).delete();

      return NextResponse.json({ success: true, hardDeleted: true });
    }

    if (!departmentId || semesterParam == null) {
      return NextResponse.json({ error: "departmentId and semester are required" }, { status: 400 });
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
