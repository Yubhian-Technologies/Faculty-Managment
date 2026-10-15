export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { loadYearGate } from "@/lib/departments/yearAccess";
import { planTeachingHoursSync } from "@/lib/subjects/hoursCascade";
import { SUBJECT_LIMITS } from "@/lib/subjects/validation/SubjectValidator";
import { CURRICULUM_ROLES, subjectErrorResponse } from "@/lib/subjects/http";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { getHodDepartmentScope, canHodEditDepartmentId, canHodEditDepartment } from "@/lib/departments/scope";
import { sectionAssignmentScope } from "@/lib/departments/sectionAssignmentScope";
import { resolveSectionCurrentSemester } from "@/lib/college/semester";
import { SubjectInstanceService } from "@/lib/subjects/services/SubjectInstanceService";
import { cachedCollectionDocs } from "@/lib/firestore/sharedReads";
import { getInChunks } from "@/lib/firestore/inQuery";
import type { Course, Department, Subject, SubjectSemesterAssignment } from "@/types";

// A master Subject (catalog course + regulation, department-independent) becomes a concrete
// Subject Instance (SubjectSemesterAssignment, types/teaching.ts) for ONE department's
// year + semester. Instances are CREATED only by assign-by-code/route.ts; this route lists
// them (GET), edits one department's hours/credits (PATCH) and unassigns (DELETE).
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
    // "The subjects assigned to THIS section" - resolved from the section itself (see below).
    const forSectionId = searchParams.get("forSectionId");

    // Need at least courseId or subjectId to narrow the query
    if (!courseId && !subjectId && !forSectionId) {
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

    // Section mode: the caller starts from a section, not from a department it already resolved.
    // Assign to Semester files a shared first year's subjects under the MANAGING department
    // (e.g. BS-ENGLISH), never under each branch it feeds (CE) - so asking by the branch's own
    // department found nothing for a managed branch. sectionAssignmentScope resolves the
    // governing department(s) and the programme's course docs exactly as teaching-assignments
    // does. `currentSemesterOnly=1` keeps just the semester the section's course-year is in now
    // (a course-year with no semesters configured keeps every row, as before).
    if (forSectionId) {
      const sectionSnap = await collegeRef.collection("sections").doc(forSectionId).get();
      if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
      const section = sectionSnap.data() as { department: string; courseId?: string; year: number };
      if (hodScope && !canHodEditDepartment(hodScope, section.department)) {
        return NextResponse.json({ error: "This section isn't in your department" }, { status: 403 });
      }
      const [courseDocs, deptDocs] = await Promise.all([
        cachedCollectionDocs(db, session.collegeId, "courses"),
        cachedCollectionDocs(db, session.collegeId, "departments"),
      ]);
      const scope = sectionAssignmentScope(
        section,
        courseDocs.map((d) => ({ id: d.id, ...d.data() })) as Pick<Course, "id" | "departmentId" | "catalogId">[],
        deptDocs.map((d) => ({ id: d.id, ...d.data() })) as (Department & { id: string })[]
      );
      const currentSemester = section.courseId
        ? await resolveSectionCurrentSemester(db, session.collegeId, section.courseId, section.year)
        : null;
      // Narrowed by department (a single-field `in`, so no composite index) rather than by
      // course: every department files its assignments under its own Course doc.
      const docs = scope.departmentIds.length
        ? await getInChunks(scope.departmentIds, (chunk) => collegeRef.collection("subjectSemesterAssignments").where("departmentId", "in", chunk))
        : [];
      const courseSet = new Set(scope.courseIds);
      let rows = docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>));
      rows = rows.filter((a) =>
        (a.courseId == null || courseSet.has(String(a.courseId))) &&
        (a.year == null || a.year === Number(section.year))
      );
      if (searchParams.get("currentSemesterOnly") === "1" && currentSemester != null) {
        rows = rows.filter((a) => a.semester === currentSemester);
      }
      return NextResponse.json({ assignments: rows, semester: currentSemester });
    }

    // If a departmentId is provided, also include assignments for any
    // child sub-departments (e.g. selecting "Basic Science" shows
    // assignments for BS-Chemistry, BS-Mathematics, etc.).
    let targetDeptIds: string[] | null = null;
    // The requested department's own NAME - a row narrowed via "Target core
    // departments" (secondaryDepartmentNames, see academics/subjects) is
    // filed under some OTHER department's id (the feeder sub-department that
    // owns it) but should still surface here when browsing straight to the
    // core department it was narrowed to, same as Teaching Assignments
    // already recognises it by.
    let requestedDeptName: string | null = null;
    if (departmentId) {
      const deptSnap = await collegeRef.collection("departments").doc(departmentId).get();
      const dept = deptSnap.data() as { name?: string; parentDepartmentId?: string; hasSubDepartments?: boolean } | undefined;
      requestedDeptName = dept?.name ?? null;
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

    // A department's copies may be filed under ANY Course doc of the programme (a shared year's older rows sit
    // under the feeder's course, later ones under the core department's), so for a department listing ask by
    // department and keep the programme's courses - asking by the one course picked missed the others.
    let docs: FirebaseFirestore.QueryDocumentSnapshot[];
    if (!subjectId && courseId && targetDeptIds && targetDeptIds.length > 0) {
      const courseDocs = await cachedCollectionDocs(db, session.collegeId, "courses");
      const picked = courseDocs.find((c) => c.id === courseId);
      const catalogId = (picked?.data() as { catalogId?: string } | undefined)?.catalogId;
      const group = new Set(catalogId ? courseDocs.filter((c) => (c.data() as { catalogId?: string }).catalogId === catalogId).map((c) => c.id) : [courseId]);
      group.add(courseId);
      const byDept = await getInChunks(targetDeptIds, (chunk) => collegeRef.collection("subjectSemesterAssignments").where("departmentId", "in", chunk));
      docs = byDept.filter((d) => {
        const c = (d.data() as { courseId?: string }).courseId;
        return !c || group.has(String(c));
      });
    } else {
      docs = (await query.get()).docs;
    }
    let assignments = docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>));

    if (academicYear) {
      assignments = assignments.filter((a) => !a.academicYear || a.academicYear === academicYear);
    }
    const narrowedToHere = (a: Record<string, unknown>) =>
      !!requestedDeptName && Array.isArray(a.secondaryDepartmentNames) && (a.secondaryDepartmentNames as unknown[]).includes(requestedDeptName);
    if (targetDeptIds && targetDeptIds.length > 0) {
      const set = new Set(targetDeptIds);
      assignments = assignments.filter((a) => (a.departmentId && set.has(String(a.departmentId))) || narrowedToHere(a));
    } else if (departmentId) {
      assignments = assignments.filter((a) => a.departmentId === departmentId || narrowedToHere(a));
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
    // department's mapping. A row narrowed to this HOD's own department via
    // secondaryDepartmentNames passes too, even though its own departmentId
    // belongs to whichever feeder sub-department actually owns it.
    if (hodScope && !departmentId) {
      assignments = assignments.filter((a) =>
        canHodEditDepartmentId(hodScope!, String(a.departmentId ?? "")) ||
        (Array.isArray(a.secondaryDepartmentNames) && (a.secondaryDepartmentNames as unknown[]).some((n) => typeof n === "string" && canHodEditDepartment(hodScope!, n)))
      );
    }

    // An HOD sees a department's assignments for the years that are theirs to see: the branch's own HOD
    // every year of the branch, the department that maintains a shared year only that year. (Without this a
    // manager listed every year of the branches it manages.) Rows narrowed to a core department by name
    // count for that department too.
    if (hodScope) {
      const gate = await loadYearGate(db, session.collegeId, hodScope);
      assignments = assignments.filter((a) => {
        const year = a.year == null ? null : Number(a.year);
        if (year == null) return true; // legacy rows carry no year
        const names = [String(a.departmentName ?? ""), ...(Array.isArray(a.secondaryDepartmentNames) ? (a.secondaryDepartmentNames as unknown[]).map(String) : [])];
        const named = names.filter(Boolean);
        if (named.length === 0) return true; // nothing to judge it by: leave it to the department filter above
        return named.some((n) => gate.view(n, year, a.courseId ? String(a.courseId) : undefined));
      });
    }

    return NextResponse.json({ assignments });
  } catch (err) {
    return subjectErrorResponse(err, "[subject-semester-assignments GET]");
  }
}

// Edits ONE department's copy of a subject: its L-T-P hours and credits (a department-level
// override of the master) and the core departments a feeder row is narrowed to. Subject-level
// fields (name, code, category, type...) are edited on the master (subjects/[id]) and reach every
// copy from there - they are never accepted here.
export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember(...CURRICULUM_ROLES);
    const body = (await readJsonBody(request)) as {
      id?: string;
      lectureHours?: number;
      tutorialHours?: number;
      practicalHours?: number;
      credits?: number;
      // Narrows this row's own broad `departmentId` (a feeder sub-department that manages several
      // core departments) down to specific core department NAMES; `null` clears it.
      secondaryDepartmentNames?: string[] | null;
    };
    if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const nums: [string, number | undefined, number][] = [
      ["lectureHours", body.lectureHours, SUBJECT_LIMITS.weeklyHours],
      ["tutorialHours", body.tutorialHours, SUBJECT_LIMITS.weeklyHours],
      ["practicalHours", body.practicalHours, SUBJECT_LIMITS.weeklyHours],
      ["credits", body.credits, SUBJECT_LIMITS.credits],
    ];
    for (const [k, v, max] of nums) {
      if (v !== undefined && (String(v).trim() === "" || !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > max)) {
        return NextResponse.json({ error: `${k} must be a number between 0 and ${max}` }, { status: 400 });
      }
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const ref = collegeRef.collection("subjectSemesterAssignments").doc(body.id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const cur = snap.data() as SubjectSemesterAssignment;

    if (body.secondaryDepartmentNames) {
      if (!Array.isArray(body.secondaryDepartmentNames) || body.secondaryDepartmentNames.some((n) => typeof n !== "string" || !n.trim())) {
        return NextResponse.json({ error: "secondaryDepartmentNames must be a list of non-empty names" }, { status: 400 });
      }
      const known = new Set((await cachedCollectionDocs(db, session.collegeId, "departments")).map((d) => String((d.data() as { name?: string }).name ?? "")));
      const unknown = body.secondaryDepartmentNames.filter((n) => !known.has(n));
      if (unknown.length > 0) return NextResponse.json({ error: `Unknown department${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}` }, { status: 400 });
    }

    const lectureHours = body.lectureHours !== undefined ? Number(body.lectureHours) : cur.lectureHours ?? 0;
    const tutorialHours = body.tutorialHours !== undefined ? Number(body.tutorialHours) : cur.tutorialHours ?? 0;
    const practicalHours = body.practicalHours !== undefined ? Number(body.practicalHours) : cur.practicalHours ?? 0;
    const credits = body.credits !== undefined ? Number(body.credits) : cur.credits ?? 0;
    const hoursPerWeek = lectureHours + tutorialHours + practicalHours;
    const prevHoursPerWeek = (cur.lectureHours ?? 0) + (cur.tutorialHours ?? 0) + (cur.practicalHours ?? 0);
    const touchesNumbers = nums.some(([, v]) => v !== undefined);

    // Teaching assignments copy hoursPerWeek (it caps their timetable periods); keep them in step,
    // but never below the periods already placed. Nothing is written if that would be violated.
    const plan = cur.departmentId && hoursPerWeek !== prevHoursPerWeek
      ? await planTeachingHoursSync(db, session.collegeId, cur.subjectId, [{
          departmentId: cur.departmentId, semester: cur.semester, year: cur.year, hoursPerWeek, hoursChanged: true,
        }])
      : { sync: [] as { ref: FirebaseFirestore.DocumentReference; hoursPerWeek: number }[], error: undefined };
    if (plan.error) return NextResponse.json({ error: plan.error }, { status: 409 });

    // "Customized" means this copy now differs from its master; it then stops following the master's hours.
    let isCustomized = cur.isCustomized === true;
    if (touchesNumbers) {
      const master = (await collegeRef.collection("subjects").doc(cur.subjectId).get()).data() as Subject | undefined;
      isCustomized = !master
        || lectureHours !== (master.lectureHours ?? 0) || tutorialHours !== (master.tutorialHours ?? 0)
        || practicalHours !== (master.practicalHours ?? 0) || credits !== (master.credits ?? 0);
    }

    const now = new Date();
    const batch = new ChunkedBatch(db);
    batch.update(ref, {
      lectureHours, tutorialHours, practicalHours, hoursPerWeek, credits,
      ...(body.secondaryDepartmentNames !== undefined
        ? { secondaryDepartmentNames: body.secondaryDepartmentNames && body.secondaryDepartmentNames.length > 0 ? body.secondaryDepartmentNames : FieldValue.delete() }
        : {}),
      isCustomized,
      updatedAt: now,
    });
    for (const s of plan.sync) batch.update(s.ref, { hoursPerWeek: s.hoursPerWeek, updatedAt: now });
    await batch.commit();

    await writeAuditLogSafe(db, session.collegeId, {
      action: "SUBJECT_UPDATED",
      performedBy: session.uid,
      performedByName: session.email,
      targetId: body.id,
      details: { instance: true, code: cur.subjectCode, departmentId: cur.departmentId, semester: cur.semester, lectureHours, tutorialHours, practicalHours, credits },
    });
    return NextResponse.json({ success: true, teachingAssignmentsUpdated: plan.sync.length });
  } catch (err) {
    return subjectErrorResponse(err, "[subject-semester-assignments PATCH]");
  }
}

// Unassign: removes one department's semester copy of a subject. Refused (409) while a faculty
// teaching assignment still relies on it. The master subject and every other department's copy are untouched.
export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember(...CURRICULUM_ROLES);
    const { searchParams } = new URL(request.url);
    const subjectId = searchParams.get("subjectId");
    const departmentId = searchParams.get("departmentId");
    const semester = Number(searchParams.get("semester"));
    if (!subjectId || !departmentId || !Number.isInteger(semester) || semester < 1) {
      return NextResponse.json({ error: "subjectId, departmentId and semester are required" }, { status: 400 });
    }
    const db = getAdminDb();
    await new SubjectInstanceService(db).unassignSubjectInstance(session.collegeId, subjectId, departmentId, semester);
    await writeAuditLogSafe(db, session.collegeId, {
      action: "SUBJECT_UNASSIGNED",
      performedBy: session.uid,
      performedByName: session.email,
      targetId: subjectId,
      details: { departmentId, semester },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message.includes("active faculty teaching assignments")) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return subjectErrorResponse(err, "[subject-semester-assignments DELETE]");
  }
}
