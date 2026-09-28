export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadTimetableContext } from "@/lib/timetable/loadContext";
import { getHodDepartmentScope, canHodEditDepartment, ownDepartmentNames } from "@/lib/departments/scope";
import { isTimetableIncharge } from "@/lib/departments/timetableIncharge";
import { resolveRequestedSemester } from "@/lib/college/semester";
import {
  buildSeededDraft, draftRef, inchargeOwnDepartmentNames, isCrossDepartmentLender, loadDraft,
} from "@/lib/timetable/draftAccess";
import { validatePlacement } from "@/lib/timetable/draftPlacement";
import type { DayOfWeek, DraftSlot } from "@/types";

interface AcceptedPlacement {
  assignmentId: string;
  day: DayOfWeek;
  startPeriod: number;
  blockSize: number;
}

// Writes the placements an HOD kept checked in the import preview
// (api/college/timetable/import) into the section's TimetableDraft - never
// straight into published timetableSlots, so an import lands exactly where a
// hand-built one does: reviewable and moveable on the grid, invisible to
// faculty/students until Publish. Re-validates every placement against
// whatever the draft looks like RIGHT NOW (not the state the preview saw),
// since the two calls aren't atomic and the draft could have changed
// in between.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(
      "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF",
    );
    const body = (await request.json()) as {
      sectionId?: string;
      semester?: number;
      placements?: AcceptedPlacement[];
    };
    const { sectionId, placements } = body;
    if (!sectionId) return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    if (!placements || placements.length === 0) {
      return NextResponse.json({ error: "No placements to import" }, { status: 400 });
    }
    if (placements.length > 200) {
      return NextResponse.json({ error: "Too many placements in one import" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    let requestedSemester: number | null | undefined;
    if (body.semester != null) {
      const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
      if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
      const section = sectionSnap.data() as { courseId: string; year: number };
      const semesterResult = await resolveRequestedSemester(db, session.collegeId, section.courseId, section.year, body.semester);
      if (!semesterResult.ok) return NextResponse.json({ error: semesterResult.error }, { status: 400 });
      requestedSemester = semesterResult.semester;
    }

    const ctx = await loadTimetableContext(db, session.collegeId, sectionId, requestedSemester);
    if (!ctx) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    if (!ctx.timing) {
      return NextResponse.json({ error: "No period timing is configured for this course year." }, { status: 409 });
    }

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (
        !canHodEditDepartment(scope, ctx.section.department) &&
        !(await isCrossDepartmentLender(db, session.collegeId, ownDepartmentNames(scope), sectionId))
      ) {
        return NextResponse.json({ error: "This section isn't in your department" }, { status: 403 });
      }
    } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      const ok = await isTimetableIncharge(db, session.collegeId, session.uid, ctx.section.courseId, ctx.section.year);
      if (!ok) {
        const myNames = await inchargeOwnDepartmentNames(db, session.collegeId, session.uid);
        const lending = await isCrossDepartmentLender(db, session.collegeId, myNames, sectionId);
        if (!lending) {
          return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
        }
      }
    }

    const existingDraft = await loadDraft(db, session.collegeId, sectionId, ctx.currentSemester);
    const seeded = existingDraft ? null : await buildSeededDraft(db, session.collegeId, sectionId, ctx, session.email);
    const workingSlots: DraftSlot[] = [...(existingDraft?.slots ?? seeded?.slots ?? [])];
    const accepted: { placement: AcceptedPlacement; slots: DraftSlot[] }[] = [];
    const failed: { placement: AcceptedPlacement; error: string }[] = [];

    for (const placement of placements) {
      const assignment = ctx.assignments.find((a) => a.id === placement.assignmentId && !a.isPast);
      if (!assignment) {
        failed.push({ placement, error: "That teaching assignment is not on this section" });
        continue;
      }
      const subject = ctx.subjectsById.get(assignment.subjectId);
      const blockSize = subject?.type === "PRACTICAL" ? Math.max(1, placement.blockSize) : 1;

      const problem = validatePlacement(ctx, { slots: workingSlots }, {
        facultyId: assignment.facultyId,
        facultyName: assignment.facultyName,
        subjectId: assignment.subjectId,
        day: placement.day,
        startPeriod: placement.startPeriod,
        blockSize,
        ignore: new Set<string>(),
      });
      if (problem) {
        failed.push({ placement, error: problem });
        continue;
      }

      const newSlots: DraftSlot[] = Array.from({ length: blockSize }, (_, i) => ({
        assignmentId: assignment.id,
        facultyId: assignment.facultyId,
        facultyName: assignment.facultyName,
        subjectId: assignment.subjectId,
        subjectName: assignment.subjectName,
        subjectType: subject?.type ?? "THEORY",
        day: placement.day,
        periodNumber: placement.startPeriod + i,
        isBlockContinuation: i > 0,
      }));
      workingSlots.push(...newSlots);
      accepted.push({ placement, slots: newSlots });
    }

    if (accepted.length > 0) {
      const sortedSlots = [...workingSlots].sort(
        (a, b) => (a.day === b.day ? a.periodNumber - b.periodNumber : a.day.localeCompare(b.day)),
      );
      // A brand-new draft writes every seeded field alongside the imported
      // slots in one shot; an existing draft only ever touches slots/status,
      // same as the hand-edit PATCH route, so nothing else about it changes.
      const writeBody = existingDraft
        ? { slots: sortedSlots, status: "DRAFT" as const }
        : { ...seeded!, slots: sortedSlots };
      await draftRef(db, session.collegeId, sectionId, ctx.currentSemester).set(writeBody, { merge: true });
    }

    return NextResponse.json({
      imported: accepted.length,
      failed: failed.map((f) => ({ ...f.placement, error: f.error })),
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable/import/confirm POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
