export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import { istDateKey, istTimeHHMM } from "@/lib/attendance/istTime";
import { makeLiveSlotPredicate } from "@/lib/timetable/liveSlots";
import { loadTimingLookup } from "@/lib/timetable/facultyOverlap";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import { normalizeHHMM, dayOfWeekFromISODate } from "@/lib/timetable/leisureQuery";
import { facultyActiveOn, loadLabWindows } from "@/lib/students/labFacultyWindow";
import { DEFAULT_TIMETABLE_RULES } from "@/types";
import type { CourseYearTiming, PeriodTiming, Section, TimetableRules, TimetableSlot } from "@/types";

// "Teaching at this time": every class in session RIGHT NOW (IST) - or in a
// date + clock window when the caller sends one - college-wide - which room, which year / department / section, which subject
// and who is taking it. The counterpart of faculty-leisure (who is NOT
// teaching). Principal, Vice Principal and admins only; unlike the leisure list
// it is never narrowed to an HOD's department.
//
// A slot counts when it is live (this course-year's current semester and this
// academic session), a lab's faculty is within their own dates that day, and
// its period OVERLAPS the window - judged against the slot's own course-year
// clock, so the window never has to line up with period boundaries.
// Published slots only: an unpublished draft is not a class being held.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_ADMIN", "DIRECTOR", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const departmentFilter = (searchParams.get("department") ?? "").trim();
    // No date / window given = right now, in IST: the classes whose period
    // contains this minute. A window is only used when a caller sends one.
    const nowIST = new Date();
    const date = (searchParams.get("date") ?? "").trim() || istDateKey(nowIST);
    const day = dayOfWeekFromISODate(date);
    let from = normalizeHHMM(searchParams.get("from"));
    let to = normalizeHHMM(searchParams.get("to"));
    if (!from || !to) {
      const nowHHMM = istTimeHHMM(nowIST);
      from = nowHHMM === "23:59" ? "23:58" : nowHHMM;
      const [h, m] = from.split(":").map(Number);
      const next = h * 60 + m + 1;
      to = `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
    }
    if (!day) return NextResponse.json({ error: "There are no classes today (not a working day)" }, { status: 400 });
    if (from >= to) return NextResponse.json({ error: "Set a time range where 'to' is after 'from'" }, { status: 400 });

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const [rulesSnap, deptsSnap, slotsSnap] = await Promise.all([
      collegeRef.collection("settings").doc("timetableRules").get(),
      collegeRef.collection("departments").get(),
      collegeRef.collection("timetableSlots").where("day", "==", day).get(),
    ]);
    const rules: TimetableRules = rulesSnap.exists
      ? { ...DEFAULT_TIMETABLE_RULES, ...(rulesSnap.data() as Partial<TimetableRules>) }
      : DEFAULT_TIMETABLE_RULES;
    if (!rules.workingDays.includes(day)) {
      return NextResponse.json({ error: "There are no classes today (not a working day)" }, { status: 400 });
    }

    const slots = slotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot & { id: string });
    const { lookup, timings } = await loadTimingLookup(
      db, session.collegeId,
      slots.map((s) => ({ courseId: s.courseId, year: Number(s.year) })),
    );
    // Widest course-year clock, only for a slot whose course-year has no timing at all.
    let widest: PeriodTiming[] = [];
    for (const t of timings) {
      const own = (t as CourseYearTiming).periods?.length ? (t as CourseYearTiming).periods! : defaultPeriodTimings(t as CourseYearTiming);
      if (own.length > widest.length) widest = own;
    }
    const periodsFor = (courseId: string, year: number): PeriodTiming[] => {
      const t = lookup(courseId, year);
      return !t ? widest : t.periods && t.periods.length > 0 ? t.periods : defaultPeriodTimings(t);
    };

    const currentAcademicYear = await resolveCollegeAcademicYear(db, session.collegeId);
    const isLive = makeLiveSlotPredicate(lookup, currentAcademicYear);
    const labWindows = await loadLabWindows(db, session.collegeId, slots);

    const inSession = slots.filter((s) => {
      if (!isLive({ courseId: s.courseId, year: s.year, semester: s.semester, academicYear: s.academicYear })) return false;
      if (!facultyActiveOn(labWindows, s.sectionId, s.subjectId, s.facultyId, date)) return false;
      const pt = periodsFor(s.courseId, Number(s.year)).find((p) => p.period === s.periodNumber);
      return !!pt && pt.startTime < to && pt.endTime > from;
    });

    // Non-teaching subjects (Counselling, Library, ... - "Don't include in teaching load" or
    // type NON_TEACHING) are not classes being taught, so they are left out of the list.
    const subjectIds = Array.from(new Set(inSession.map((s) => s.subjectId).filter(Boolean)));
    const subjectSnaps = subjectIds.length > 0
      ? await db.getAll(...subjectIds.map((id) => collegeRef.collection("subjects").doc(id)))
      : [];
    const nonTeachingSubjectIds = new Set(
      subjectSnaps
        .filter((d) => {
          const sub = d.data() as { isNonTeachingLoad?: boolean; type?: string } | undefined;
          return !!sub && (sub.isNonTeachingLoad === true || sub.type === "NON_TEACHING");
        })
        .map((d) => d.id),
    );

    const sectionIds = Array.from(new Set(inSession.map((s) => s.sectionId).filter(Boolean)));
    const sectionSnaps = sectionIds.length > 0
      ? await db.getAll(...sectionIds.map((id) => collegeRef.collection("sections").doc(id)))
      : [];
    const sectionById = new Map(sectionSnaps.filter((d) => d.exists).map((d) => [d.id, d.data() as Section]));

    // A parent department also covers its sub-departments (BASIC SCIENCE
    // includes BASIC SCIENCE MATHS), the same grouping Leisure faculty uses.
    let departmentScope: Set<string> | null = null;
    if (departmentFilter) {
      departmentScope = new Set([departmentFilter]);
      const rows = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as { name?: string; parentDepartmentId?: string | null }) }));
      const rootIds = new Set(rows.filter((r) => (r.name ?? "").trim() === departmentFilter).map((r) => r.id));
      for (let grew = true; grew;) {
        grew = false;
        for (const r of rows) {
          if (r.parentDepartmentId && rootIds.has(r.parentDepartmentId) && !rootIds.has(r.id)) {
            rootIds.add(r.id);
            departmentScope.add((r.name ?? "").trim());
            grew = true;
          }
        }
      }
    }

    // One row per class + subject + room; co-teachers and lab batches of the
    // same class fold into it with their names joined.
    type Row = { classroom: string; year: number; department: string; sectionName: string; classLabel: string; subject: string; faculty: string[] };
    const rowsByKey = new Map<string, Row>();
    for (const s of inSession) {
      if (nonTeachingSubjectIds.has(s.subjectId)) continue;
      const sec = sectionById.get(s.sectionId);
      if (!sec) continue;
      const dept = (sec.department ?? "").trim();
      if (departmentScope && !departmentScope.has(dept)) continue;
      const classroom = (s.classroom ?? "").trim() || (sec.classroomNumber ?? "").trim();
      const key = `${s.sectionId}|${s.subjectId}|${classroom}`;
      const row = rowsByKey.get(key) ?? {
        classroom,
        year: Number(sec.year),
        department: dept,
        sectionName: sec.name,
        classLabel: `${ordinalYearLabel(sec.year)} - ${dept} - ${sec.name}`,
        subject: s.subjectName,
        faculty: [],
      };
      if (s.facultyName && !row.faculty.includes(s.facultyName)) row.faculty.push(s.facultyName);
      rowsByKey.set(key, row);
    }

    const classes = Array.from(rowsByKey.values())
      .sort((a, b) => a.department.localeCompare(b.department) || a.year - b.year || a.sectionName.localeCompare(b.sectionName))
      .map((r) => ({ classroom: r.classroom, classLabel: r.classLabel, subject: r.subject, faculty: r.faculty.join(", ") }));

    return NextResponse.json({ classes, asOf: { date, from } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/teaching-now GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
