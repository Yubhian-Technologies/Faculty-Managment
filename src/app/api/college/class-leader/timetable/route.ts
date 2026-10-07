export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getActiveSubstitutionsForDates, currentWeekDateKeys } from "@/lib/leave/periodCoverage";
import { resolveCurrentSemester, matchesCurrentSemester, loadEffectiveTiming } from "@/lib/college/semester";
import { DEFAULT_TIMETABLE_RULES } from "@/types";
import type {
  Course,
  Department,
  Section,
  Subject,
  TimetableSlot,
  TeachingAssignment,
  TimetableRules,
} from "@/types";

// Class Leader Timetable & Dashboard API:
// Returns the caller's own bound Section, its course details, timing, current-semester
// timetable slots (with live substitutions), and current-semester teaching assignments.
// For CLASS_LEADER role, access is strictly locked to their own assigned section.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("CLASS_LEADER");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const { searchParams } = new URL(request.url);

    const weekParam = searchParams.get("week");
    const semesterParam = searchParams.get("semester");
    const requestedSemester = semesterParam != null && semesterParam !== "" ? Number(semesterParam) : null;

    const userSnap = await collegeRef.collection("users").doc(session.uid).get();
    const ownSectionId = (userSnap.data() as { sectionId?: string } | undefined)?.sectionId ?? null;

    // requireCollegeMember("CLASS_LEADER") above guarantees session.role is
    // always "CLASS_LEADER" here, so there is no non-class-leader caller to
    // fall back for - strictly the caller's own bound section, never a
    // client-supplied sectionId (which would let a class leader with no
    // section on file view an arbitrary one instead).
    const targetSectionId = ownSectionId;

    if (!targetSectionId) {
      return NextResponse.json({
        course: null,
        section: null,
        timing: null,
        slots: [],
        assignments: [],
        subjects: [],
        resolvedSemester: null,
        availableSemesters: [],
        workingDays: DEFAULT_TIMETABLE_RULES.workingDays,
        ownSectionId: null,
      });
    }

    const sectionSnap = await collegeRef.collection("sections").doc(targetSectionId).get();
    if (!sectionSnap.exists) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }
    const section = { id: sectionSnap.id, ...sectionSnap.data() } as Section;

    // Fetch this section's course, timings, slots, teaching assignments, and departments
    const [courseSnap, timing, slotsSnap, assignmentsSnap, deptsSnap, rulesSnap] = await Promise.all([
      collegeRef.collection("courses").doc(section.courseId).get(),
      // Includes the main department's timing for a sub-department / shared-year section.
      loadEffectiveTiming(db, session.collegeId, section.courseId, section.year),
      collegeRef.collection("timetableSlots").where("sectionId", "==", targetSectionId).get(),
      collegeRef.collection("teachingAssignments").where("sectionId", "==", targetSectionId).get(),
      collegeRef.collection("departments").get(),
      // The same college-wide rules POST college/timetable-slots validates a new
      // slot's `day` against - sent so the grid lays out over the days this
      // college actually teaches instead of a hardcoded Mon-Sat.
      collegeRef.collection("settings").doc("timetableRules").get(),
    ]);

    const timetableRules: TimetableRules = rulesSnap.exists
      ? { ...DEFAULT_TIMETABLE_RULES, ...(rulesSnap.data() as Partial<TimetableRules>) }
      : DEFAULT_TIMETABLE_RULES;

    const course = courseSnap.exists ? ({ id: courseSnap.id, ...courseSnap.data() } as Course) : null;
    const departments = deptsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Department);

    // Current semester resolution: explicit user choice or derived from
    // timings - the choice must actually be one of this course-year's
    // configured semesters, the same validated-request convention
    // resolveRequestedSemester (lib/college/semester.ts) enforces for POST
    // callers elsewhere in this codebase. Without this, a bad/non-numeric
    // param (e.g. "abc" -> NaN) passed straight through to
    // matchesCurrentSemester below, which is never true for NaN, silently
    // blanking the whole timetable instead of falling back to the resolved
    // current one.
    const configuredSemesters = (timing?.semesters ?? []).map((s) => s.semester);
    const validRequestedSemester =
      requestedSemester != null && Number.isFinite(requestedSemester) &&
      (configuredSemesters.length === 0 || configuredSemesters.includes(requestedSemester))
        ? requestedSemester
        : null;
    const currentSemester = validRequestedSemester != null ? validRequestedSemester : resolveCurrentSemester(timing);

    // Fetch subjects for this course so we can map subject types and details
    const subjectsSnap = await collegeRef
      .collection("subjects")
      .where("courseId", "==", section.courseId)
      .get();
    const subjectMap = new Map<string, Subject>(
      subjectsSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() } as Subject])
    );

    // Filter slots for the current semester and join subject details
    const rawSlots = slotsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as TimetableSlot & { id: string }))
      .filter((s) => matchesCurrentSemester(s.semester, currentSemester))
      .map((s) => {
        const sub = s.subjectId ? subjectMap.get(s.subjectId) : undefined;
        return {
          ...s,
          subjectCode: sub?.code,
          shortCode: sub?.shortCode,
          subjectType: sub?.type,
        };
      });

    // Filter teaching assignments strictly for current semester & active status
    const assignments = assignmentsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as TeachingAssignment & { id: string }))
      .filter((a) => {
        if (a.isPast) return false;
        const sem = a.timetableSemester ?? a.semester;
        if (sem != null && currentSemester != null) {
          return matchesCurrentSemester(sem, currentSemester);
        }
        return true;
      })
      .map((a) => {
        const sub = a.subjectId ? subjectMap.get(a.subjectId) : undefined;
        return {
          ...a,
          shortCode: a.shortCode || sub?.shortCode,
          subjectType: a.subjectType || sub?.type,
        };
      });

    // Overlay active substitutions for the displayed week
    const substitutions = await getActiveSubstitutionsForDates(
      db,
      session.collegeId,
      currentWeekDateKeys(weekParam ?? undefined)
    );
    const substitutionBySlotId = new Map(substitutions.map((s) => [s.timetableSlotId, s]));
    const slots = rawSlots.map((s) => {
      const sub = substitutionBySlotId.get(s.id);
      return sub
        ? {
            ...s,
            substituteFacultyId: sub.substituteFacultyId,
            substituteFacultyName: sub.substituteFacultyName,
            substituteForName: sub.requesterName,
            substituteDate: sub.date,
          }
        : s;
    });

    const availableSemesters = timing?.semesters ?? [];

    return NextResponse.json({
      course,
      section,
      timing,
      slots,
      assignments,
      // Full Subject docs so the grid/PDF/Excel can resolve each subject's own
      // shortCode/code/type rather than deriving an abbreviation from the name.
      subjects: Array.from(subjectMap.values()),
      resolvedSemester: currentSemester,
      availableSemesters,
      workingDays: timetableRules.workingDays,
      ownSectionId,
      departments,
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/class-leader/timetable GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
