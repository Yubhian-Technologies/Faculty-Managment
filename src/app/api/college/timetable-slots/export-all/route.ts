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

// Bulk counterpart to GET /api/college/timetable-slots: the CURRENT-semester published
// timetable of many sections, for the Principal / Academics Timetable View. A section with
// nothing published, or whose course-year has no Course-Year Timings at all, is left out - the
// same "no timetable yet" state the single-section view already shows, just skipped here.
//
// Two cheap calls instead of one that reads the whole college (every section, every subject,
// every published slot):
//   ?optionsOnly=1        -> the sections themselves (no slots, no subjects): what the Course /
//                            Department / Year / Section pickers are built from.
//   ?sectionIds=a,b,c     -> the timetables of exactly those sections (at most MAX_IDS): the slots are
//                            read for those sections only, and only the subjects those slots use.
const MAX_IDS = 150;

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const { searchParams } = new URL(request.url);

    if (searchParams.get("optionsOnly") === "1") {
      const snap = await collegeRef.collection("sections").get();
      const sections = snap.docs
        .map((d) => {
          const x = d.data() as Section;
          return { id: d.id, name: x.name, department: x.department, year: x.year, courseId: x.courseId, courseName: x.courseName ?? "", batch: x.batch };
        })
        .sort((a, b) => a.department.localeCompare(b.department) || a.year - b.year || a.name.localeCompare(b.name));
      return NextResponse.json({ sections });
    }

    const ids = Array.from(new Set((searchParams.get("sectionIds") ?? "").split(",").map((x) => x.trim()).filter(Boolean)));
    if (ids.length === 0) return NextResponse.json({ error: "sectionIds is required" }, { status: 400 });
    if (ids.length > MAX_IDS) return NextResponse.json({ error: `At most ${MAX_IDS} sections per request` }, { status: 400 });

    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));

    const [sectionDocs, coursesSnap, deptsSnap, timingsSnap, rulesSnap, currentAcademicYear, ...slotSnaps] =
      await Promise.all([
        db.getAll(...ids.map((id) => collegeRef.collection("sections").doc(id))),
        collegeRef.collection("courses").get(),
        collegeRef.collection("departments").get(),
        collegeRef.collection("courseYearTimings").get(),
        collegeRef.collection("settings").doc("timetableRules").get(),
        resolveCollegeAcademicYear(db, session.collegeId),
        ...chunks.map((c) => collegeRef.collection("timetableSlots").where("sectionId", "in", c).get()),
      ]);

    const rules: TimetableRules = rulesSnap.exists
      ? { ...DEFAULT_TIMETABLE_RULES, ...(rulesSnap.data() as Partial<TimetableRules>) }
      : DEFAULT_TIMETABLE_RULES;

    const courses = coursesSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as (Course & { id: string })[];
    const departments = deptsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as (Department & { id: string })[];
    const courseById = new Map(courses.map((c) => [c.id, c]));
    const timingsByDocId = new Map(timingsSnap.docs.map((d) => [d.id, d.data() as CourseYearTiming]));

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
    for (const snap of slotSnaps) {
      for (const d of snap.docs) {
        const slot = { id: d.id, ...d.data() } as TimetableSlot & { id: string };
        const list = slotsBySection.get(slot.sectionId) ?? [];
        list.push(slot);
        slotsBySection.set(slot.sectionId, list);
      }
    }

    const sections = sectionDocs
      .filter((d) => d.exists)
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

    // Only the subjects these timetables actually use (not the whole subject catalogue).
    const subjectIds = Array.from(new Set(result.flatMap((r) => r.slots.map((s) => s.subjectId)).filter((x): x is string => !!x)));
    const subjectDocs = subjectIds.length > 0
      ? await db.getAll(...subjectIds.map((id) => collegeRef.collection("subjects").doc(id)))
      : [];
    const subjects = subjectDocs.filter((d) => d.exists).map((d) => ({ id: d.id, ...d.data() })) as (Subject & { id: string })[];

    return NextResponse.json({ workingDays: rules.workingDays, subjects, sections: result });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable-slots/export-all GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
