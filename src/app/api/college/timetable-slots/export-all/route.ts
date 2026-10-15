export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveCurrentSemester, matchesCurrentSemester } from "@/lib/college/semester";
import { matchesCurrentAcademicYear } from "@/lib/college/academicSession";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import { inheritedTimingCourseId } from "@/lib/timetable/sharedYearTiming";
import { DEFAULT_TIMETABLE_RULES } from "@/types";
import type { Course, CourseYearTiming, Department, Section, Subject, TimetableRules, TimetableSlot } from "@/types";

// Bulk counterpart to GET /api/college/timetable-slots: every section's
// CURRENT-semester published timetable in one read, for the Principal/
// Academics "Download all departments" button. A section with nothing
// published, or whose course-year has no Course-Year Timings at all, is left
// out entirely - the same "no timetable yet" state the single-section view
// already shows, just skipped here instead of rendered as an empty page.
export async function GET() {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const [sectionsSnap, coursesSnap, deptsSnap, timingsSnap, subjectsSnap, slotsSnap, rulesSnap, currentAcademicYear] =
      await Promise.all([
        collegeRef.collection("sections").get(),
        collegeRef.collection("courses").get(),
        collegeRef.collection("departments").get(),
        collegeRef.collection("courseYearTimings").get(),
        collegeRef.collection("subjects").get(),
        collegeRef.collection("timetableSlots").get(),
        collegeRef.collection("settings").doc("timetableRules").get(),
        resolveCollegeAcademicYear(db, session.collegeId),
      ]);

    const rules: TimetableRules = rulesSnap.exists
      ? { ...DEFAULT_TIMETABLE_RULES, ...(rulesSnap.data() as Partial<TimetableRules>) }
      : DEFAULT_TIMETABLE_RULES;

    const courses = coursesSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as (Course & { id: string })[];
    const departments = deptsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as (Department & { id: string })[];
    const courseById = new Map(courses.map((c) => [c.id, c]));
    const timingsByDocId = new Map(timingsSnap.docs.map((d) => [d.id, d.data() as CourseYearTiming]));
    const subjects = subjectsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as (Subject & { id: string })[];

    // Same shared-first-year fallback loadEffectiveTiming uses, inlined here
    // since every course-year is resolved locally in one pass rather than
    // one Firestore round-trip per section.
    function effectiveTiming(courseId: string, year: number): CourseYearTiming | null {
      const direct = timingsByDocId.get(`${courseId}_year${year}`);
      if (direct) return direct;
      const ownCourse = courseById.get(courseId);
      if (!ownCourse) return null;
      const inheritedId = inheritedTimingCourseId(ownCourse, year, departments, courses);
      return inheritedId ? (timingsByDocId.get(`${inheritedId}_year${year}`) ?? null) : null;
    }

    const slotsBySection = new Map<string, (TimetableSlot & { id: string })[]>();
    for (const d of slotsSnap.docs) {
      const slot = { id: d.id, ...d.data() } as TimetableSlot & { id: string };
      const list = slotsBySection.get(slot.sectionId) ?? [];
      list.push(slot);
      slotsBySection.set(slot.sectionId, list);
    }

    const sections = sectionsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as Section & { id: string })
      .sort((a, b) => a.department.localeCompare(b.department) || a.year - b.year || a.name.localeCompare(b.name));

    const result: {
      sectionId: string;
      sectionName: string;
      departmentName: string;
      courseName: string;
      year: number;
      batch: string;
      regulation?: string;
      currentSemester: number | null;
      timing: CourseYearTiming;
      slots: (TimetableSlot & { id: string })[];
    }[] = [];

    for (const section of sections) {
      const timing = effectiveTiming(section.courseId, section.year);
      if (!timing) continue; // not configured - nothing to publish against anyway
      const currentSemester = resolveCurrentSemester(timing, new Date());
      const all = slotsBySection.get(section.id) ?? [];
      const slots = all.filter(
        (s) => matchesCurrentSemester(s.semester, currentSemester) && matchesCurrentAcademicYear(s.academicYear, currentAcademicYear)
      );
      if (slots.length === 0) continue; // nothing published for this section's current semester

      result.push({
        sectionId: section.id,
        sectionName: section.name,
        departmentName: section.department,
        courseName: section.courseName ?? courseById.get(section.courseId)?.name ?? "",
        year: section.year,
        batch: section.batch,
        regulation: section.regulation,
        currentSemester,
        timing,
        slots,
      });
    }

    return NextResponse.json({ workingDays: rules.workingDays, subjects, sections: result });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable-slots/export-all GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
