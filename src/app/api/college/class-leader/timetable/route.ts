export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getActiveSubstitutionsForDates, currentWeekDateKeys } from "@/lib/leave/periodCoverage";
import { resolveCurrentSemester, matchesCurrentSemester } from "@/lib/college/semester";
import type { CourseYearTiming, TimetableSlot } from "@/types";

// Self-contained read for the Class Leader dashboard AND timetable page (both
// call this one endpoint): resolves the caller's own bound Section (never a
// client-supplied id) and returns everything either page needs - timetable
// grid data, plus the section's per-subject faculty assignments for the
// dashboard's "Subjects & Faculty" list - in one call. Deliberately not
// widening teaching-assignments GET's own role list for this instead: that
// route trusts a client-supplied sectionId with no ownership check, which
// would let a Class Leader query any OTHER section's assignments too. Reads
// live on every request (no caching layer) so any reassignment HOD makes via
// the Teaching Assignments editor shows up here immediately.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("CLASS_LEADER");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    // Optional - the timetable page's own calendar picker, browsing a week
    // other than the current one. Any date within the target week works
    // (see currentWeekDateKeys, which resolves it back to that week's
    // Monday). Omitted keeps the previous "this calendar week" default.
    const weekParam = new URL(request.url).searchParams.get("week");

    const userSnap = await collegeRef.collection("users").doc(session.uid).get();
    const sectionId = (userSnap.data() as { sectionId?: string } | undefined)?.sectionId;
    if (!sectionId) {
      return NextResponse.json({ error: "No section is linked to this login" }, { status: 404 });
    }

    const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
    if (!sectionSnap.exists) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }
    const section = { id: sectionSnap.id, ...sectionSnap.data() } as { id: string; courseId: string; year: number };

    const [courseSnap, timingsSnap, slotsSnap, assignmentsSnap] = await Promise.all([
      collegeRef.collection("courses").doc(section.courseId).get(),
      collegeRef.collection("courseYearTimings").where("courseId", "==", section.courseId).get(),
      collegeRef.collection("timetableSlots").where("sectionId", "==", sectionId).get(),
      collegeRef.collection("teachingAssignments").where("sectionId", "==", sectionId).get(),
    ]);

    const course = courseSnap.exists ? { id: courseSnap.id, ...courseSnap.data() } : null;
    const timing = timingsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as unknown as CourseYearTiming)
      .find((t) => t.year === section.year) ?? null;
    const currentSemester = resolveCurrentSemester(timing);
    // A prior semester's published slots stay in Firestore as history (see
    // publish/route.ts) but drop out of the student's live weekly grid once
    // the next semester starts.
    const rawSlots = slotsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot & { id: string })
      .filter((s) => matchesCurrentSemester(s.semester, currentSemester));
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

    return NextResponse.json({ course, section, timing, slots, assignments });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/class-leader/timetable GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
