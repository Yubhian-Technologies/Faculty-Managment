export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { getActiveSubstitutionsForDates, currentWeekDateKeys } from "@/lib/leave/periodCoverage";
import { resolveSectionCurrentSemester, resolveRequestedSemester, matchesCurrentSemester } from "@/lib/college/semester";
import { currentTimetableAcademicYear, matchesCurrentAcademicYear } from "@/lib/college/academicSession";
import { isTimetableIncharge } from "@/lib/departments/timetableIncharge";
import type { DayOfWeek, TimetableSlot } from "@/types";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF", "VICE_PRINCIPAL");
    const { searchParams } = new URL(request.url);
    const sectionId = searchParams.get("sectionId");
    if (!sectionId) {
      return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    }
    // Optional - the Timetable editor's own semester picker, or Timetable
    // History browsing a semester other than whichever is live today.
    // Omitted keeps the previous "whatever today's date resolves to" default.
    const semesterParam = searchParams.get("semester");
    const requestedSemester = semesterParam != null ? Number(semesterParam) : null;
    // Optional - Timetable History browsing a PAST cohort's own timetable for
    // this same section (a Section is a fixed year-slot a new cohort occupies
    // every academic year - see Section.batch). Omitted keeps the previous
    // "this session" default.
    const academicYearParam = searchParams.get("academicYear");
    // Optional - the grid's own calendar picker, browsing a week other than
    // the current one. Any date within the target week works (see
    // currentWeekDateKeys, which resolves it back to that week's Monday).
    // Omitted keeps the previous "this calendar week" default.
    const weekParam = searchParams.get("week");

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
    if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    const section = sectionSnap.data() as { courseId: string; year: number };
    const semesterResult = await resolveRequestedSemester(db, session.collegeId, section.courseId, section.year, requestedSemester);
    if (!semesterResult.ok) {
      return NextResponse.json({ error: semesterResult.error }, { status: 400 });
    }
    const currentSemester = semesterResult.semester;
    const currentAcademicYear = currentTimetableAcademicYear();
    const requestedAcademicYear = academicYearParam || currentAcademicYear;
    // Explicitly browsing an OLDER session (Timetable History) needs strict
    // equality, not the usual null-tolerant match - an untagged/legacy slot
    // is far more likely to just be today's current data than genuinely from
    // whatever specific past year was asked for, so it should show up under
    // "current" (the default, still lenient) but never get mislabeled as a
    // specific history year it may not actually belong to.
    const isBrowsingPastYear = requestedAcademicYear !== currentAcademicYear;

    const snap = await collegeRef.collection("timetableSlots")
      .where("sectionId", "==", sectionId)
      .get();
    // A prior semester's or prior session's published slots stay in
    // Firestore as history (see publish/route.ts) but drop out of this
    // "current timetable" read once the next one starts - unless `semester`/
    // `academicYear` above explicitly asked for that prior one.
    const rawSlots = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot & { id: string })
      .filter((s) =>
        matchesCurrentSemester(s.semester, currentSemester) &&
        (isBrowsingPastYear ? s.academicYear === requestedAcademicYear : matchesCurrentAcademicYear(s.academicYear, requestedAcademicYear))
      );

    // Overlay the displayed week's approved-leave substitutions, if any -
    // who's actually taking a period on a given day instead of the regular
    // weekly assignment (see lib/leave/periodCoverage.ts). Covers every day
    // of that week, not just today - see currentWeekDateKeys. Only ever the
    // week actually being viewed (weekParam, defaulting to this week) - a
    // substitution dated for a different week simply isn't in this set, so
    // it never shows up under the wrong day. Never changes the underlying
    // record, just what this read returns.
    const substitutions = await getActiveSubstitutionsForDates(db, session.collegeId, currentWeekDateKeys(weekParam ?? undefined));
    const substitutionBySlotId = new Map(substitutions.map((s) => [s.timetableSlotId, s]));
    const slots = rawSlots.map((s) => {
      const sub = substitutionBySlotId.get((s as { id: string }).id);
      return sub
        ? { ...s, substituteFacultyId: sub.substituteFacultyId, substituteFacultyName: sub.substituteFacultyName, substituteForName: sub.requesterName, substituteDate: sub.date }
        : s;
    });

    return NextResponse.json({ slots });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable-slots GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF");
    const body = (await request.json()) as {
      assignmentId: string;
      day: DayOfWeek;
      periodNumber: number;
      classroom?: string;
    };

    const { assignmentId, day, periodNumber } = body;
    if (!assignmentId || !day || !periodNumber) {
      return NextResponse.json({ error: "assignmentId, day and periodNumber are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const assignmentSnap = await collegeRef.collection("teachingAssignments").doc(assignmentId).get();
    if (!assignmentSnap.exists) return NextResponse.json({ error: "Teaching assignment not found" }, { status: 404 });
    const assignment = assignmentSnap.data() as {
      facultyId: string; facultyName: string; courseId: string; year: number;
      sectionId: string; subjectId: string; subjectName: string; department: string;
      timetableSemester?: number;
    };

    // This pins a slot straight into a section's published timetable - an
    // HOD may only do that for their own department (or one they own/manage),
    // same restriction as publish/route.ts and timetable/draft above. Was
    // previously unchecked - any HOD who knew/guessed another department's
    // assignmentId could pin a slot into that department's section.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartment(scope, assignment.department)) {
        return NextResponse.json({ error: "That teaching assignment is not in your department" }, { status: 403 });
      }
    } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      const ok = await isTimetableIncharge(db, session.collegeId, session.uid, assignment.courseId, assignment.year);
      if (!ok) {
        return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
      }
    }

    // This assignment's own course-year semester - stamped onto the new slot
    // below, and used to exclude a PRIOR semester's own slots (history, not
    // a live conflict) from both checks that follow. Prefers the semester
    // the assignment itself was created under (see teaching-assignments/
    // route.ts POST) so a slot pinned outside that semester's own live date
    // window still lands under the right one, rather than re-resolving
    // "today" and possibly landing under a DIFFERENT semester than the
    // assignment it's for.
    const assignmentSemester = assignment.timetableSemester
      ?? await resolveSectionCurrentSemester(db, session.collegeId, assignment.courseId, assignment.year);
    // This session - same reasoning as teaching-assignments/route.ts POST.
    const currentAcademicYear = currentTimetableAcademicYear();

    const conflictSnap = await collegeRef.collection("timetableSlots")
      .where("sectionId", "==", assignment.sectionId)
      .where("day", "==", day)
      .where("periodNumber", "==", Number(periodNumber))
      .get();
    const conflict = conflictSnap.docs.some((d) => {
      const data = d.data() as TimetableSlot;
      return matchesCurrentSemester(data.semester, assignmentSemester) && matchesCurrentAcademicYear(data.academicYear, currentAcademicYear);
    });
    if (conflict) {
      return NextResponse.json(
        { error: `Conflict: this section already has a subject scheduled on ${day} period ${periodNumber}` },
        { status: 409 }
      );
    }

    // A faculty member can't teach two classes at once - block regardless of
    // section/year/course. Each candidate slot may belong to a different
    // course-year than this one, so its own semester is resolved
    // individually rather than reusing assignmentSemester.
    const facultyConflictSnap = await collegeRef.collection("timetableSlots")
      .where("facultyId", "==", assignment.facultyId)
      .where("day", "==", day)
      .where("periodNumber", "==", Number(periodNumber))
      .get();
    let facultyConflict: TimetableSlot | null = null;
    for (const d of facultyConflictSnap.docs) {
      const other = d.data() as TimetableSlot;
      const otherSemester = await resolveSectionCurrentSemester(db, session.collegeId, other.courseId, other.year);
      if (matchesCurrentSemester(other.semester, otherSemester) && matchesCurrentAcademicYear(other.academicYear, currentAcademicYear)) {
        facultyConflict = other; break;
      }
    }
    if (facultyConflict) {
      return NextResponse.json(
        { error: `Conflict: ${assignment.facultyName || "this faculty"} already teaches ${facultyConflict.subjectName ?? "another class"} on ${day} period ${periodNumber} in a different section` },
        { status: 409 }
      );
    }

    const now = new Date();
    const ref = await collegeRef.collection("timetableSlots").add({
      collegeId: session.collegeId,
      department: assignment.department,
      assignmentId,
      facultyId: assignment.facultyId,
      facultyName: assignment.facultyName,
      courseId: assignment.courseId,
      year: assignment.year,
      sectionId: assignment.sectionId,
      subjectId: assignment.subjectId,
      subjectName: assignment.subjectName,
      day,
      periodNumber: Number(periodNumber),
      classroom: body.classroom ?? null,
      // This route backs the per-faculty "Weekly Schedule" picker, so anything
      // created here was placed deliberately by a human. Marking it MANUAL/pinned
      // makes the generator schedule around it and stops publish from replacing
      // it (the publish route only clears source === "GENERATED" slots).
      source: "MANUAL",
      isPinned: true,
      semester: assignmentSemester,
      academicYear: currentAcademicYear,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable-slots POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
