export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, ownDepartmentNames } from "@/lib/departments/scope";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { resolveCurrentSemester, matchesCurrentSemester } from "@/lib/college/semester";
import { isFacultyAvailable, DEFAULT_TIMETABLE_RULES } from "@/types";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import type { CourseYearTiming, DayOfWeek, TimetableDraft, TimetableRules, TimetableSlot } from "@/types";

// College-wide "who is free at this time": every available faculty member with
// NO class on the given day + period, in any department. Restricted to the
// oversight roles (Principal, Vice Principal, Exam Cell, ...) - the same list as
// the Timetable pages. An HOD gets the same list narrowed to their own
// department (plus its sub-departments) - the busy check stays college-wide, so
// someone lent to another department still reads as busy. Only ever returns
// employee id, name and department.
//
// Busy = a published slot OR an unpublished draft slot (a draft still occupies
// the faculty - see faculty-schedule), each checked against its own course-year's
// current semester. Matching is by day + period NUMBER, the app-wide convention.
//
// Without day/period it just returns the pickers' options (working days and
// widest period count).
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "EXAM_CELL", "COLLEGE_ADMIN", "DIRECTOR", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const day = searchParams.get("day") as DayOfWeek | null;
    const period = Number(searchParams.get("period"));

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const [rulesSnap, timingsSnap] = await Promise.all([
      collegeRef.collection("settings").doc("timetableRules").get(),
      collegeRef.collection("courseYearTimings").get(),
    ]);
    const rules: TimetableRules = rulesSnap.exists
      ? { ...DEFAULT_TIMETABLE_RULES, ...(rulesSnap.data() as Partial<TimetableRules>) }
      : DEFAULT_TIMETABLE_RULES;
    const timingByCourseYear = new Map<string, CourseYearTiming>();
    let periodCount = 0;
    for (const d of timingsSnap.docs) {
      const t = d.data() as CourseYearTiming;
      timingByCourseYear.set(`${t.courseId}_${t.year}`, t);
      const n = t.periods && t.periods.length > 0 ? t.periods.length : defaultPeriodTimings(t).length;
      periodCount = Math.max(periodCount, n);
    }

    if (!day || !Number.isInteger(period) || period < 1) {
      return NextResponse.json({ workingDays: rules.workingDays, periodCount });
    }
    if (!rules.workingDays.includes(day)) {
      return NextResponse.json({ error: "Not a working day" }, { status: 400 });
    }

    const [facultySnap, slotsSnap, draftsSnap] = await Promise.all([
      collegeRef.collection("facultyMembers").get(),
      collegeRef.collection("timetableSlots").where("day", "==", day).where("periodNumber", "==", period).get(),
      collegeRef.collection("timetableDrafts").get(),
    ]);

    const inCurrentSemester = (courseId: string, year: number, semester: number | null | undefined) =>
      matchesCurrentSemester(semester ?? null, resolveCurrentSemester(timingByCourseYear.get(`${courseId}_${year}`) ?? null));

    const busy = new Set<string>();
    for (const d of slotsSnap.docs) {
      const s = d.data() as TimetableSlot;
      if (s.facultyId && inCurrentSemester(s.courseId, s.year, s.semester)) busy.add(s.facultyId);
    }
    for (const d of draftsSnap.docs) {
      const draft = d.data() as TimetableDraft;
      if (draft.status !== "DRAFT" || !inCurrentSemester(draft.courseId, draft.year, draft.semester)) continue;
      for (const ds of draft.slots ?? []) {
        if (ds.facultyId && ds.day === day && ds.periodNumber === period) busy.add(ds.facultyId);
      }
    }

    // HOD: own department tree only (ownDepartmentNames, the narrowest scope).
    const hodDepartments = session.role === "HOD"
      ? new Set(ownDepartmentNames(await getHodDepartmentScope(db, session.collegeId, session.uid)))
      : null;

    const faculty = facultySnap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as { id: string; legalName?: string; status?: string; department?: string; employeeId?: string })
      .filter((f) => isFacultyAvailable(f.status) && !busy.has(f.id) && (!hodDepartments || hodDepartments.has(f.department ?? "")))
      .map((f) => ({ id: f.id, employeeId: f.employeeId ?? "", name: facultyDisplayName(f), department: f.department ?? "" }))
      .sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));

    return NextResponse.json({ workingDays: rules.workingDays, periodCount, faculty });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty-leisure GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
