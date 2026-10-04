export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { pinSlotWithChecks } from "@/lib/timetable/pinSlot";
import { loadTimingLookup } from "@/lib/timetable/facultyOverlap";
import { makeLiveSlotPredicate } from "@/lib/timetable/liveSlots";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { getActiveSubstitutionsForDates, currentWeekDateKeys } from "@/lib/leave/periodCoverage";
import { resolveSectionCurrentSemester, resolveRequestedSemester, matchesCurrentSemester } from "@/lib/college/semester";
import { matchesCurrentAcademicYear } from "@/lib/college/academicSession";
import { isTimetableIncharge } from "@/lib/departments/timetableIncharge";
import type { DayOfWeek, SubjectType, TimetableRules, TimetableSlot } from "@/types";
import { DEFAULT_TIMETABLE_RULES } from "@/types";
import { loadDepartmentIndex, stampDepartmentIds } from "@/lib/departments/stampIds";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF", "VICE_PRINCIPAL", "EXAM_CELL", "ACADEMICS");
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
    const [semesterResult] = await Promise.all([
      resolveRequestedSemester(db, session.collegeId, section.courseId, section.year, requestedSemester),
    ]);
    if (!semesterResult.ok) {
      return NextResponse.json({ error: semesterResult.error }, { status: 400 });
    }
    const currentSemester = semesterResult.semester;
    const currentAcademicYear = await resolveCollegeAcademicYear(db, session.collegeId);
    const requestedAcademicYear = academicYearParam || currentAcademicYear;
    // Explicitly browsing an OLDER session (Timetable History) needs strict
    // equality, not the usual null-tolerant match - an untagged/legacy slot
    // is far more likely to just be today's current data than genuinely from
    // whatever specific past year was asked for, so it should show up under
    // "current" (the default, still lenient) but never get mislabeled as a
    // specific history year it may not actually belong to.
    const isBrowsingPastYear = requestedAcademicYear !== currentAcademicYear;

    const [snap, subjectsSnap, rulesSnap] = await Promise.all([
      collegeRef.collection("timetableSlots").where("sectionId", "==", sectionId).get(),
      // Joined onto each slot below so the Timetable pages' Theory/Practical
      // filter can group by SubjectType without a second round-trip - same
      // technique as class-leader/timetable/route.ts's own Theory/Lab filter.
      // Master subjects are scoped by courseId + regulation (no year),
      // so we query by courseId without a year filter. Legacy subjects
      // (which have year) are also matched since they share the same courseId.
      collegeRef.collection("subjects").where("courseId", "==", section.courseId).get(),
      // The college's own working days, so a read-only grid lays out over the
      // days this college actually teaches instead of a hardcoded Mon-Sat.
      collegeRef.collection("settings").doc("timetableRules").get(),
    ]);
    const rules: TimetableRules = rulesSnap.exists
      ? { ...DEFAULT_TIMETABLE_RULES, ...(rulesSnap.data() as Partial<TimetableRules>) }
      : DEFAULT_TIMETABLE_RULES;
    const subjectDocs = subjectsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }));
    const subjectTypeById = new Map(subjectsSnap.docs.map((d) => [d.id, (d.data() as { type?: SubjectType }).type]));
    // A prior semester's or prior session's published slots stay in
    // Firestore as history (see publish/route.ts) but drop out of this
    // "current timetable" read once the next one starts - unless `semester`/
    // `academicYear` above explicitly asked for that prior one.
    const rawSlots = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot & { id: string })
      .filter((s) =>
        matchesCurrentSemester(s.semester, currentSemester) &&
        (isBrowsingPastYear ? s.academicYear === requestedAcademicYear : matchesCurrentAcademicYear(s.academicYear, requestedAcademicYear))
      )
      .map((s) => ({ ...s, subjectType: s.subjectId ? subjectTypeById.get(s.subjectId) : undefined }));

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

    return NextResponse.json({ slots, subjects: subjectDocs, workingDays: rules.workingDays });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable-slots GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    // VICE_PRINCIPAL included to match the sibling draft/publish routes
    // (timetable/draft/route.ts, timetable/publish/route.ts), which already
    // grant this role the same capability - manually pinning one slot is a
    // narrower version of the same "build this section's timetable" action
    // those routes allow.
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF");
    const body = (await readJsonBody(request)) as {
      assignmentId: string;
      day: DayOfWeek;
      periodNumber: number;
      classroom?: string;
      // Explicit opt-in for a split period (two+ subjects/faculty sharing
      // one section+day+period, e.g. half the section in an English Lab and
      // half in a Chemistry Lab at once) - only set by a deliberate "add
      // another subject to this period" action, never inferred, so an
      // ordinary double-booking still gets rejected below by default.
      allowSplit?: boolean;
      // Free-text lab sub-group label - see TimetableSlot.labBatch's own
      // doc-comment. Set only at creation time from the row's "Lab Batch"
      // field in TeachingAssignmentsEditor.
      labBatch?: string;
    };

    const { assignmentId, day, periodNumber } = body;
    if (!assignmentId || !day || !periodNumber) {
      return NextResponse.json({ error: "assignmentId, day and periodNumber are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const assignmentSnap = await collegeRef.collection("teachingAssignments").doc(assignmentId).get();
    if (!assignmentSnap.exists) return NextResponse.json({ error: "Teaching assignment not found" }, { status: 404 });
    const assignmentData = assignmentSnap.data() as {
      facultyId: string; facultyName: string; courseId?: string; year?: number;
      sectionId?: string; subjectId: string; subjectName: string; department: string;
      timetableSemester?: number;
    };

    if (!assignmentData.sectionId || !assignmentData.courseId || assignmentData.year == null) {
      return NextResponse.json(
        { error: "Teaching assignment must be linked to a course, year, and section to schedule timetable slots" },
        { status: 400 }
      );
    }
    const assignment = {
      ...assignmentData,
      courseId: assignmentData.courseId,
      year: assignmentData.year,
      sectionId: assignmentData.sectionId,
    };

    // Resolve subject type to gate lab-only split — only PRACTICAL may use allowSplit/labBatch
    const subjectSnapForType = await collegeRef.collection("subjects").doc(assignment.subjectId).get();
    const subjectType = (subjectSnapForType.data() as { type?: string } | undefined)?.type;
    const isLabSubject = subjectType === "PRACTICAL";
    if (!isLabSubject && (body.allowSplit || body.labBatch)) {
      return NextResponse.json({ error: "Only lab (PRACTICAL) subjects can be split into batches" }, { status: 400 });
    }

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
    const currentAcademicYear = await resolveCollegeAcademicYear(db, session.collegeId);

    // This route backs the manual per-faculty pin (see `source: "MANUAL"`
    // below) and previously skipped the college's own TimetableRules
    // entirely - a human deliberately placing one period is still bound by
    // the same working-days and daily-cap rules the draft editor enforces,
    // not just the section/faculty double-booking checks further down.
    const rulesSnap = await collegeRef.collection("settings").doc("timetableRules").get();
    const rules: TimetableRules = rulesSnap.exists
      ? { ...DEFAULT_TIMETABLE_RULES, ...(rulesSnap.data() as Partial<TimetableRules>) }
      : DEFAULT_TIMETABLE_RULES;

    if (!rules.workingDays.includes(day)) {
      return NextResponse.json({ error: `${day} is not a working day.` }, { status: 400 });
    }

    // The daily cap, the cell-taken / split-lab rules and the write are ONE transaction under the section's
    // and the faculty member's guard documents (lib/timetable/pinSlot.ts), so
    // two pins landing together can't both pass the checks.
    const deptIndex = await loadDepartmentIndex(db, session.collegeId);
    const { lookup: timingLookup } = await loadTimingLookup(db, session.collegeId, [{ courseId: assignment.courseId, year: assignment.year }]);
    const pinned = await pinSlotWithChecks({
      db,
      collegeId: session.collegeId,
      assignmentId,
      facultyId: assignment.facultyId,
      facultyName: assignment.facultyName,
      courseId: assignment.courseId,
      year: assignment.year,
      sectionId: assignment.sectionId,
      subjectId: assignment.subjectId,
      subjectName: assignment.subjectName,
      department: assignment.department,
      day,
      periodNumber: Number(periodNumber),
      classroom: body.classroom ?? null,
      labBatch: body.labBatch,
      allowSplit: body.allowSplit,
      semester: assignmentSemester,
      currentAcademicYear,
      maxPeriodsPerFacultyPerDay: rules.maxPeriodsPerFacultyPerDay,
      isLiveSlot: makeLiveSlotPredicate(timingLookup, currentAcademicYear),
      stamp: (data) => stampDepartmentIds(data, deptIndex),
      writer: session.uid,
    });
    if (!pinned.ok) {
      return NextResponse.json({ error: pinned.error }, { status: 409 });
    }

    return NextResponse.json({ id: pinned.id }, { status: 201 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable-slots POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
