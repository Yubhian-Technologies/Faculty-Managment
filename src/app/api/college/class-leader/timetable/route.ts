export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getActiveSubstitutionsForDates, currentWeekDateKeys } from "@/lib/leave/periodCoverage";
import { resolveCurrentSemester, matchesCurrentSemester } from "@/lib/college/semester";
import type { Course, CourseYearTiming, Department, Section, Subject, TimetableSlot } from "@/types";

// Self-contained read for the Class Leader dashboard AND timetable page (both
// call this one endpoint): resolves the caller's own bound Section (never a
// client-supplied id, UNLESS `sectionId` is explicitly passed - see below) and
// returns everything either page needs - timetable grid data, plus the
// section's per-subject faculty assignments for the dashboard's "Subjects &
// Faculty" list - in one call. Deliberately not widening teaching-assignments
// GET's own role list for this instead: that route trusts a client-supplied
// sectionId with no ownership check for editing purposes, which is a
// different concern from this route's own read-only browse below.
//
// `sectionId`/`semester` (both optional) let the Timetable page's own
// Course -> Department -> Semester -> Section picker browse ANY section's
// published timetable, not just the caller's own - the picked `semester` is
// used AS-IS (not re-derived from today's date via resolveCurrentSemester)
// since the student is deliberately choosing which one to view. Omitting both
// keeps the exact previous behavior (own section, today's date-resolved
// semester) for the dashboard's own call, which never passes either.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("CLASS_LEADER");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const { searchParams } = new URL(request.url);
    // Optional - the timetable page's own calendar picker, browsing a week
    // other than the current one. Any date within the target week works (see
    // currentWeekDateKeys, which resolves it back to that week's Monday).
    // Omitted keeps the previous "this calendar week" default.
    const weekParam = searchParams.get("week");
    const sectionIdParam = searchParams.get("sectionId");
    const semesterParam = searchParams.get("semester");
    const requestedSemester = semesterParam != null && semesterParam !== "" ? Number(semesterParam) : null;

    const userSnap = await collegeRef.collection("users").doc(session.uid).get();
    const ownSectionId = (userSnap.data() as { sectionId?: string } | undefined)?.sectionId ?? null;
    const targetSectionId = sectionIdParam || ownSectionId;

    // The Course -> Department -> Semester -> Section picker's own option
    // lists - fetched every call (small per-college collections, same
    // full-fetch pattern already used by TeachingAssignmentsEditor and the
    // HOD Teaching Assignments route) so the picker works even before any
    // section is resolved below (e.g. a class leader with no bound section
    // yet, browsing someone else's). Purely additive - the dashboard's own
        // call ignores these.
    const [coursesSnap, departmentsSnap, sectionsSnap, timingsSnap] = await Promise.all([
      collegeRef.collection("courses").get(),
      collegeRef.collection("departments").get(),
      collegeRef.collection("sections").get(),
      collegeRef.collection("courseYearTimings").get(),
    ]);
    const courses = coursesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Course);
    const departments = departmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Department);
    const sections = sectionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Section);
    const courseYearTimings = timingsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as CourseYearTiming);

    if (!targetSectionId) {
      return NextResponse.json({
        course: null, section: null, timing: null, slots: [], assignments: [], resolvedSemester: null,
        ownSectionId, courses, departments, sections, courseYearTimings,
      });
    }

    const sectionSnap = await collegeRef.collection("sections").doc(targetSectionId).get();
    if (!sectionSnap.exists) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }
    const section = { id: sectionSnap.id, ...sectionSnap.data() } as Section;

    const [courseSnap, subjectsSnap, slotsSnap, assignmentsSnap] = await Promise.all([
      collegeRef.collection("courses").doc(section.courseId).get(),
      collegeRef.collection("subjects").where("courseId", "==", section.courseId).where("year", "==", section.year).get(),
      collegeRef.collection("timetableSlots").where("sectionId", "==", targetSectionId).get(),
      collegeRef.collection("teachingAssignments").where("sectionId", "==", targetSectionId).get(),
    ]);

    const course = courseSnap.exists ? { id: courseSnap.id, ...courseSnap.data() } : null;
    const timing = courseYearTimings.find((t) => t.courseId === section.courseId && t.year === section.year) ?? null;
    // Explicitly-picked semester wins outright; otherwise fall back to
    // whichever one today's date resolves to (the previous, only, behavior).
    const currentSemester = requestedSemester != null ? requestedSemester : resolveCurrentSemester(timing);
    // Joined onto each slot so the page's Theory/Lab optional filter can
    // group by SubjectType without a second round-trip - subjects for this
    // exact course+year is a small set, fetched once above.
    const subjectTypeById = new Map(subjectsSnap.docs.map((d) => [d.id, (d.data() as Subject).type]));
    // A prior semester's published slots stay in Firestore as history (see
    // publish/route.ts) but drop out of the live weekly grid once the next
    // semester starts - or once a DIFFERENT semester is explicitly picked.
    const rawSlots = slotsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot & { id: string })
      .filter((s) => matchesCurrentSemester(s.semester, currentSemester))
      .map((s) => ({ ...s, subjectType: s.subjectId ? subjectTypeById.get(s.subjectId) : undefined }));
    const assignments = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Overlay the displayed week's approved-leave substitutions, covering
    // every day of that week (not just today) - see lib/leave/periodCoverage.ts
    // and the same overlay in GET college/timetable-slots. Only ever the
    // week actually being viewed (weekParam, defaulting to this week) - a
    // substitution dated for a different week simply isn't in this set.
    const substitutions = await getActiveSubstitutionsForDates(db, session.collegeId, currentWeekDateKeys(weekParam ?? undefined));
    const substitutionBySlotId = new Map(substitutions.map((s) => [s.timetableSlotId, s]));
    const slots = rawSlots.map((s) => {
      const sub = substitutionBySlotId.get((s as { id: string }).id);
      return sub
        ? { ...s, substituteFacultyId: sub.substituteFacultyId, substituteFacultyName: sub.substituteFacultyName, substituteForName: sub.requesterName, substituteDate: sub.date }
        : s;
    });

    return NextResponse.json({
      course, section, timing, slots, assignments, resolvedSemester: currentSemester,
      ownSectionId, courses, departments, sections, courseYearTimings,
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/class-leader/timetable GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
