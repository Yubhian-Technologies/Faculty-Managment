export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodManageAssignment } from "@/lib/departments/scope";
import { isTimetableIncharge } from "@/lib/departments/timetableIncharge";
import { COLLECTION, normalizeRanges } from "@/lib/studentAttendance/labAllocation";
import type { Department, TeachingAssignment } from "@/types";
import type { DepartmentYearRow } from "@/lib/departments/managedBranches";

// "Allocate attendance faculty": an HOD / Sub-HOD, or the Timetable Incharge of
// a course-year, opens one LAB (PRACTICAL) teaching assignment's student
// attendance for its own faculty on chosen date ranges - see
// lib/studentAttendance/labAllocation.ts for what that lifts. The doc id is the
// assignmentId, so saving again replaces the ranges and an empty list removes it.

const ROLES = ["HOD", "PANEL_MEMBER", "COLLEGE_STAFF"] as const;

// The allocations for a list of assignment ids (the ones the caller's own
// Teaching Assignments list already shows them), keyed by assignment.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const ids = (new URL(request.url).searchParams.get("assignmentIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return NextResponse.json({ allocations: [] });
    if (ids.length > 500) return NextResponse.json({ error: "Too many assignmentIds" }, { status: 400 });

    const db = getAdminDb();
    const col = db.collection("colleges").doc(session.collegeId).collection(COLLECTION);
    const snaps = await db.getAll(...ids.map((id) => col.doc(id)));
    const allocations = snaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }));
    return NextResponse.json({ allocations });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/lab-attendance-allocations GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const body = (await readJsonBody(request)) as { assignmentId?: string; ranges?: unknown };
    const assignmentId = body.assignmentId?.trim();
    if (!assignmentId) return NextResponse.json({ error: "assignmentId is required" }, { status: 400 });
    const normalized = normalizeRanges(body.ranges);
    if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const assignmentSnap = await collegeRef.collection("teachingAssignments").doc(assignmentId).get();
    if (!assignmentSnap.exists) return NextResponse.json({ error: "Teaching assignment not found" }, { status: 404 });
    const assignment = assignmentSnap.data() as TeachingAssignment;
    if (assignment.isPast || !assignment.sectionId || !assignment.facultyId) {
      return NextResponse.json({ error: "Only a current, section-wise lab assignment can be allocated" }, { status: 400 });
    }

    const [subjectSnap, courseSnap] = await Promise.all([
      collegeRef.collection("subjects").doc(assignment.subjectId).get(),
      assignment.courseId ? collegeRef.collection("courses").doc(assignment.courseId).get() : Promise.resolve(null),
    ]);
    if ((subjectSnap.data() as { type?: string } | undefined)?.type !== "PRACTICAL") {
      return NextResponse.json({ error: "Only a lab (PRACTICAL) subject can be allocated" }, { status: 400 });
    }

    // Same people who manage the assignment itself: an HOD for their own
    // department/sub-department/managed year (or their own faculty), the
    // Timetable Incharge for that course-year.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      const deptsSnap = await collegeRef.collection("departments").get();
      const allDepartments = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as (DepartmentYearRow & Pick<Department, "name">)[];
      const catalogId = (courseSnap?.data() as { catalogId?: string } | undefined)?.catalogId;
      if (!(await canHodManageAssignment(db, session.collegeId, scope, allDepartments, assignment, catalogId))) {
        return NextResponse.json({ error: "This lab is not in your department, its sub-departments or a year you manage" }, { status: 403 });
      }
    } else {
      const ok = assignment.courseId && assignment.year != null
        && await isTimetableIncharge(db, session.collegeId, session.uid, assignment.courseId, assignment.year);
      if (!ok) return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
    }

    const ref = collegeRef.collection(COLLECTION).doc(assignmentId);
    if (normalized.ranges.length === 0) {
      await ref.delete();
    } else {
      const now = new Date();
      const existing = await ref.get();
      await ref.set({
        collegeId: session.collegeId,
        assignmentId,
        facultyId: assignment.facultyId,
        facultyName: assignment.facultyName ?? "",
        department: assignment.department ?? "",
        courseId: assignment.courseId ?? "",
        courseName: assignment.courseName ?? "",
        year: assignment.year ?? 0,
        sectionId: assignment.sectionId,
        sectionName: assignment.sectionName ?? "",
        subjectId: assignment.subjectId,
        subjectName: assignment.subjectName ?? "",
        subjectCode: assignment.subjectCode ?? "",
        ranges: normalized.ranges,
        allocatedBy: session.uid,
        allocatedByName: session.email || session.role,
        createdAt: existing.exists ? (existing.data() as { createdAt?: unknown }).createdAt ?? now : now,
        updatedAt: now,
      });
    }

    await writeAuditLogSafe(db, session.collegeId, {
      action: "LAB_ATTENDANCE_ALLOCATED",
      performedBy: session.uid,
      performedByName: session.email || session.role,
      targetId: assignmentId,
      details: {
        facultyId: assignment.facultyId, facultyName: assignment.facultyName, subjectName: assignment.subjectName,
        sectionName: assignment.sectionName, ranges: normalized.ranges,
      },
    });

    return NextResponse.json({ ok: true, ranges: normalized.ranges });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/lab-attendance-allocations PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
