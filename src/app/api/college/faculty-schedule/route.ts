export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldPath } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { resolveCurrentSemester, matchesCurrentSemester } from "@/lib/college/semester";
import { isFacultyAvailable } from "@/types";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import type { CourseYearTiming, FacultyAssignmentRequest, PeriodTiming, Section, TimetableDraft, TimetableSlot } from "@/types";

// A deliberately narrow, read-only cross-department lookup: unlike
// /api/college/faculty and /api/college/courses (which reject a department
// outside the caller's own management scope on purpose), an HOD or Timetable
// Incharge legitimately needs to check ANOTHER department's faculty and
// their real schedule before sending/allocating a lend request, or before
// marking a lent faculty's busy periods (see AssignmentRequestsPanel). Only
// ever returns a name and a bare schedule - never contact info, salary,
// designation, or anything else a full faculty-roster read would expose.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF");
    const { searchParams } = new URL(request.url);
    const departmentId = searchParams.get("departmentId");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    // `me=1`: the caller's own schedule - resolved server-side from the
    // session, so a faculty never has to (or can) pick anyone.
    const facultyId = searchParams.get("me") === "1"
      ? await resolveFacultyMemberId(db, session.collegeId, session.uid)
      : searchParams.get("facultyId");

    if (departmentId) {
      const deptSnap = await collegeRef.collection("departments").doc(departmentId).get();
      if (!deptSnap.exists) return NextResponse.json({ error: "Department not found" }, { status: 404 });
      const departmentName = (deptSnap.data() as { name?: string }).name ?? "";

      const facultySnap = await collegeRef.collection("facultyMembers")
        .where("department", "==", departmentName).get();
      const faculty = facultySnap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as { id: string; legalName?: string; status?: string })
        .filter((f) => isFacultyAvailable(f.status))
        .map((f) => ({ id: f.id, name: facultyDisplayName(f) }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return NextResponse.json({ faculty });
    }

    if (facultyId) {
      const facultySnap = await collegeRef.collection("facultyMembers").doc(facultyId).get();
      if (!facultySnap.exists) return NextResponse.json({ error: "Faculty not found" }, { status: 404 });
      const facultyName = facultyDisplayName(facultySnap.data() as { legalName?: string });

      const [slotsSnap, draftsSnap, requestsSnap] = await Promise.all([
        collegeRef.collection("timetableSlots").where("facultyId", "==", facultyId).get(),
        // An unpublished draft occupies this faculty just as surely as a live
        // slot does - loadTimetableContext already refuses to double-book
        // against one (see its own doc-comment), so a schedule that ignored
        // drafts showed someone "Free" in a period the app itself would not
        // let you give away. Small collection: one doc per section+semester.
        collegeRef.collection("timetableDrafts").get(),
        // Busy periods another department declared when it borrowed this
        // faculty (see FacultyAssignmentRequest.busyPeriods) - they never
        // become timetable slots, so without this the lookup showed the
        // faculty as free (or as having nothing booked at all) in hours the
        // timetable editor itself refuses to place them in.
        collegeRef.collection("facultyAssignmentRequests").where("allocatedFacultyId", "==", facultyId).get(),
      ]);
      const rawSlots = slotsSnap.docs.map((d) => d.data() as TimetableSlot);

      // Draft periods for this faculty, reshaped to look like published ones.
      // A draft that has already been published is skipped - its slots are in
      // timetableSlots above, and counting both would show them twice.
      const draftSlots: (TimetableSlot & { isDraft: true })[] = [];
      for (const d of draftsSnap.docs) {
        const draft = { id: d.id, ...d.data() } as TimetableDraft;
        if (draft.status !== "DRAFT") continue;
        for (const ds of draft.slots ?? []) {
          if (ds.facultyId !== facultyId) continue;
          draftSlots.push({
            day: ds.day, periodNumber: ds.periodNumber, subjectName: ds.subjectName,
            courseId: draft.courseId, year: draft.year, sectionId: draft.sectionId,
            semester: draft.semester ?? null, isDraft: true,
          } as unknown as TimetableSlot & { isDraft: true });
        }
      }

      // Declared-busy periods, reshaped like slots in the course-year they were
      // declared against (the lender picks that year explicitly; older entries
      // fall back to the request's own), so the period grid below lays out
      // against the right timings.
      for (const d of requestsSnap.docs) {
        const r = d.data() as FacultyAssignmentRequest;
        if (r.status !== "ALLOCATED") continue;
        for (const bp of r.busyPeriods ?? []) {
          draftSlots.push({
            day: bp.day, periodNumber: bp.period, subjectName: r.subjectName,
            courseId: r.courseId, year: bp.year ?? r.year, sectionId: "",
            semester: null, isDraft: false, isDeclared: true, declaredFor: r.requestingDepartment,
          } as unknown as TimetableSlot & { isDraft: true });
        }
      }

      // Only THIS faculty's currently-relevant slots - each checked against
      // its OWN course-year's current semester (a slot from an
      // already-finished semester of its own course-year must never read as
      // "busy" today), same rule loadTimetableContext's busyFaculty already
      // follows. Timings are fetched once per distinct (courseId, year) pair
      // in this small set, not per slot.
      const distinctCourseYears = new Map<string, { courseId: string; year: number }>();
      for (const s of [...rawSlots, ...draftSlots]) distinctCourseYears.set(`${s.courseId}_${s.year}`, { courseId: s.courseId, year: s.year });
      const currentSemesterByCourseYear = new Map<string, number | null>();
      // Kept so the grid can be laid out against a real course-year's own
      // periods without the caller having to pick one - see `periods` below.
      const timingByCourseYear = new Map<string, CourseYearTiming | null>();
      await Promise.all(
        Array.from(distinctCourseYears.entries()).map(async ([key, { courseId, year }]) => {
          const timingSnap = await collegeRef.collection("courseYearTimings").doc(`${courseId}_year${year}`).get();
          const timing = timingSnap.exists ? (timingSnap.data() as CourseYearTiming) : null;
          timingByCourseYear.set(key, timing);
          currentSemesterByCourseYear.set(key, resolveCurrentSemester(timing));
        }),
      );

      const currentSlots = [...rawSlots, ...draftSlots].filter(
        (s) => matchesCurrentSemester(s.semester, currentSemesterByCourseYear.get(`${s.courseId}_${s.year}`) ?? null),
      );

      // sectionName/courseName for display - Section already carries both
      // (see Section.courseName), so one lookup covers both instead of a
      // separate courses fetch.
      const sectionIds = Array.from(new Set(currentSlots.map((s) => s.sectionId).filter(Boolean)));
      const sectionById = new Map<string, Section>();
      for (let i = 0; i < sectionIds.length; i += 30) {
        const chunk = sectionIds.slice(i, i + 30);
        const chunkSnap = await collegeRef.collection("sections").where(FieldPath.documentId(), "in", chunk).get();
        for (const d of chunkSnap.docs) sectionById.set(d.id, { id: d.id, ...d.data() } as Section);
      }

      const slots = currentSlots.map((s) => {
        const section = sectionById.get(s.sectionId);
        return {
          day: s.day,
          periodNumber: s.periodNumber,
          subjectName: s.subjectName,
          courseName: section?.courseName ?? "",
          departmentName: section?.department ?? "",
          year: s.year,
          sectionName: section?.name ?? "",
          isDraft: (s as { isDraft?: boolean }).isDraft === true,
          isDeclared: (s as { isDeclared?: boolean }).isDeclared === true,
          declaredFor: (s as { declaredFor?: string }).declaredFor ?? "",
        };
      });

      // How many periods to draw, and their clock times. Taken from the
      // faculty's OWN course-years so the caller no longer has to choose a
      // course and year purely to shape the grid. Widest one wins, so a
      // faculty teaching a 7-period and an 8-period course-year still sees
      // every period they are booked in.
      let periods: PeriodTiming[] = [];
      for (const timing of timingByCourseYear.values()) {
        if (!timing) continue;
        const own = timing.periods && timing.periods.length > 0 ? timing.periods : defaultPeriodTimings(timing);
        if (own.length > periods.length) periods = own;
      }
      // No timings at all (or no slots yet): fall back to the widest period
      // the faculty actually appears in, so their booked periods are never
      // hidden by a grid that stops short.
      const maxPeriod = slots.reduce((m, s) => Math.max(m, s.periodNumber), 0);
      if (periods.length < maxPeriod) {
        periods = Array.from({ length: maxPeriod }, (_, i) => ({ period: i + 1, startTime: "", endTime: "" }));
      }

      return NextResponse.json({ facultyName, slots, periods });
    }

    return NextResponse.json({ error: "departmentId or facultyId is required" }, { status: 400 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty-schedule GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
