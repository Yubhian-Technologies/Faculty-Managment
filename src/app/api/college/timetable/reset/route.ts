export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { getAdminDb } from "@/lib/firebase/admin";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { getHodDepartmentScope, canHodManageAssignment } from "@/lib/departments/scope";
import type { Department } from "@/types";
import type { DepartmentYearRow } from "@/lib/departments/managedBranches";
import { isTimetableIncharge } from "@/lib/departments/timetableIncharge";
import { resolveRequestedSemester, matchesCurrentSemester } from "@/lib/college/semester";
import { deleteAssignmentWithSlots } from "@/lib/teaching/deleteAssignment";
import { draftRef } from "@/lib/timetable/draftAccess";
import { bumpGuards, lockGuards, sectionGuard } from "@/lib/timetable/guards";

// Wipes one section's whole timetable for a semester, published or not: its
// draft, every live slot, and the teaching assignments behind them, so the
// Teaching Assignments tab and every faculty's Teaching Load start fresh.
// Past (historical) assignments are records, not part of the live timetable,
// and are kept. Each assignment goes through deleteAssignmentWithSlots, so a
// lent faculty's allocated assignment request is reopened exactly as a single
// delete does.
export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF");
    const { searchParams } = new URL(request.url);
    const sectionId = searchParams.get("sectionId");
    if (!sectionId) return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    const semesterParam = searchParams.get("semester");
    const requestedSemester = semesterParam != null ? Number(semesterParam) : null;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
    if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    const section = sectionSnap.data() as { courseId: string; year: number; department?: string; name?: string };
    const semesterResult = await resolveRequestedSemester(db, session.collegeId, section.courseId, section.year, requestedSemester);
    if (!semesterResult.ok) return NextResponse.json({ error: semesterResult.error }, { status: 400 });
    const semester = semesterResult.semester;

    // The assignments this would remove (current ones of the chosen semester;
    // past records are kept).
    const assignmentsSnap = await collegeRef.collection("teachingAssignments").where("sectionId", "==", sectionId).get();
    const targetDocs = assignmentsSnap.docs.filter((d) => {
      const a = d.data() as { isPast?: boolean; timetableSemester?: number | null };
      return !a.isPast && matchesCurrentSemester(a.timetableSemester, semester);
    });

    if (session.role === "HOD") {
      // Same rule the single-assignment delete applies (canHodManageAssignment:
      // the section's department/year - own, sub-department or a managed
      // branch's year - OR the assigned faculty is one of the HOD's own), so a
      // section whose assignments the HOD can already remove one by one can
      // also be cleared at once. Allowed when the HOD owns the section itself,
      // or every assignment being removed.
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      const deptsSnap = await collegeRef.collection("departments").get();
      const allDepartments = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as (DepartmentYearRow & Pick<Department, "name">)[];
      const courseSnap = await collegeRef.collection("courses").doc(section.courseId).get();
      const catalogId = (courseSnap.data() as { catalogId?: string } | undefined)?.catalogId;
      const ownsSection = await canHodManageAssignment(
        db, session.collegeId, scope, allDepartments,
        { department: section.department, year: section.year, courseId: section.courseId }, catalogId,
      );
      let ownsAll = targetDocs.length > 0;
      if (!ownsSection) {
        for (const d of targetDocs) {
          const a = d.data() as { department?: string; year?: number; courseId?: string; facultyId?: string };
          const cs = a.courseId ? await collegeRef.collection("courses").doc(a.courseId).get() : null;
          const cid = (cs?.data() as { catalogId?: string } | undefined)?.catalogId;
          if (!(await canHodManageAssignment(db, session.collegeId, scope, allDepartments, a, cid))) { ownsAll = false; break; }
        }
      }
      if (!ownsSection && !ownsAll) {
        return NextResponse.json({ error: "You can only clear sections in your own department, its sub-departments, a year your department manages, or assignments of your own faculty" }, { status: 403 });
      }
    } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      const ok = await isTimetableIncharge(db, session.collegeId, session.uid, section.courseId, section.year);
      if (!ok) return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
    }

    // Open and allocated assignment requests for this section go first: the
    // "requested" badges on the Teaching Assignments page come from them, and
    // deleting an allocated assignment would otherwise reopen its request as
    // PENDING. Declined/cancelled ones are history and stay. (A request has no
    // semester of its own, so it is cleared with the section.)
    const requestsSnap = await collegeRef.collection("facultyAssignmentRequests").where("sectionId", "==", sectionId).get();
    const requestBatch = new ChunkedBatch(db);
    let removedRequests = 0;
    for (const d of requestsSnap.docs) {
      const status = (d.data() as { status?: string }).status;
      if (status === "PENDING" || status === "ALLOCATED") { requestBatch.delete(d.ref); removedRequests++; }
    }
    await requestBatch.commit();

    // Teaching assignments next (each takes the section guard itself), then
    // whatever slots and the draft are left.
    let removedAssignments = 0;
    let removedSlots = 0;
    for (const d of targetDocs) {
      const removed = await deleteAssignmentWithSlots(db, session.collegeId, d.id, session.uid);
      if (removed) { removedAssignments++; removedSlots += removed.slotCount; }
    }

    const guards = [sectionGuard(db, session.collegeId, sectionId)];
    await db.runTransaction(async (tx) => {
      await lockGuards(tx, guards);
      bumpGuards(tx, guards, session.uid);
    });
    const leftover = await collegeRef.collection("timetableSlots").where("sectionId", "==", sectionId).get();
    const batch = new ChunkedBatch(db);
    for (const d of leftover.docs) {
      if (matchesCurrentSemester((d.data() as { semester?: number | null }).semester, semester)) {
        batch.delete(d.ref);
        removedSlots++;
      }
    }
    batch.delete(draftRef(db, session.collegeId, sectionId, semester));
    await batch.commit();

    await writeAuditLogSafe(db, session.collegeId, {
      action: "TIMETABLE_RESET",
      performedBy: session.uid,
      performedByName: session.email || session.role,
      targetId: sectionId,
      details: { sectionName: section.name, year: section.year, semester, removedAssignments, removedSlots, removedRequests },
    });

    return NextResponse.json({ ok: true, removedAssignments, removedSlots, removedRequests });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable/reset DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
