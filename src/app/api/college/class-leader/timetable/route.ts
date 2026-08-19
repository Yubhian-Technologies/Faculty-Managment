export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getActiveSubstitutionsForDates, currentWeekDateKeys } from "@/lib/leave/periodCoverage";

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
export async function GET() {
  try {
    const session = await requireCollegeMember("CLASS_LEADER");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

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
      .map((d) => ({ id: d.id, ...d.data() }) as unknown as { id: string; year: number })
      .find((t) => t.year === section.year) ?? null;
    const rawSlots = slotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const assignments = assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Overlay this week's approved-leave substitutions, covering every day
    // of the displayed week (not just today) - see
    // lib/leave/periodCoverage.ts and the same overlay in
    // GET college/timetable-slots.
    const substitutions = await getActiveSubstitutionsForDates(db, session.collegeId, currentWeekDateKeys());
    const substitutionBySlotId = new Map(substitutions.map((s) => [s.timetableSlotId, s]));
    const slots = rawSlots.map((s) => {
      const sub = substitutionBySlotId.get((s as { id: string }).id);
      return sub
        ? { ...s, substituteFacultyId: sub.substituteFacultyId, substituteFacultyName: sub.substituteFacultyName, substituteForName: sub.requesterName }
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
