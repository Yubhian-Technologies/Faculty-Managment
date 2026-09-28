export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldPath } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { resolveCurrentSemester, matchesCurrentSemester } from "@/lib/college/semester";
import { isFacultyAvailable } from "@/types";
import type { CourseYearTiming, Section, TimetableSlot } from "@/types";

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
    const facultyId = searchParams.get("facultyId");

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

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

      const slotsSnap = await collegeRef.collection("timetableSlots").where("facultyId", "==", facultyId).get();
      const rawSlots = slotsSnap.docs.map((d) => d.data() as TimetableSlot);

      // Only THIS faculty's currently-relevant slots - each checked against
      // its OWN course-year's current semester (a slot from an
      // already-finished semester of its own course-year must never read as
      // "busy" today), same rule loadTimetableContext's busyFaculty already
      // follows. Timings are fetched once per distinct (courseId, year) pair
      // in this small set, not per slot.
      const distinctCourseYears = new Map<string, { courseId: string; year: number }>();
      for (const s of rawSlots) distinctCourseYears.set(`${s.courseId}_${s.year}`, { courseId: s.courseId, year: s.year });
      const currentSemesterByCourseYear = new Map<string, number | null>();
      await Promise.all(
        Array.from(distinctCourseYears.entries()).map(async ([key, { courseId, year }]) => {
          const timingSnap = await collegeRef.collection("courseYearTimings").doc(`${courseId}_year${year}`).get();
          const timing = timingSnap.exists ? (timingSnap.data() as CourseYearTiming) : null;
          currentSemesterByCourseYear.set(key, resolveCurrentSemester(timing));
        }),
      );

      const currentSlots = rawSlots.filter(
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
          year: s.year,
          sectionName: section?.name ?? "",
        };
      });

      return NextResponse.json({ facultyName, slots });
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
