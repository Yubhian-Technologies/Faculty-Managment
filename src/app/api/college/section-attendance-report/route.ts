export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import type { Section, StudentAttendanceMark, StudentAttendanceSession, TeachingAssignment } from "@/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The section's CURRENT teaching-assignment subject list (every subject an
// HOD has actually assigned a faculty to teach this section, any faculty) -
// shared by every mode below. A Subject only reaches teachingAssignments
// once it's part of the Dean Academics-defined curriculum for that
// Course+Year (subjects.courseId/year), so this is already exactly "the
// subjects assigned to that Section/Year by Dean Academics", not a separate
// query - and it's the stable, date-independent column set for every
// report mode (Monthly, Period, Till Now alike).
async function currentSectionSubjects(
  collegeRef: FirebaseFirestore.DocumentReference,
  sectionId: string
): Promise<{ subjectId: string; subjectName: string; subjectCode: string }[]> {
  const assignmentsSnap = await collegeRef.collection("teachingAssignments")
    .where("sectionId", "==", sectionId)
    .get();
  const bySubject = new Map<string, TeachingAssignment>();
  for (const doc of assignmentsSnap.docs) {
    const a = doc.data() as TeachingAssignment;
    if (a.isPast) continue;
    if (!bySubject.has(a.subjectId)) bySubject.set(a.subjectId, a);
  }
  return Array.from(bySubject.values())
    .map((a) => ({ subjectId: a.subjectId, subjectName: a.subjectName, subjectCode: a.subjectCode }))
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
}

// "Attendance Reports": Section -> Year -> Month -> Date, aggregated across
// EVERY subject and faculty assigned to that section - unlike the Faculty
// Attendance Report (see /api/college/class-work-records), which is scoped
// to one faculty's own periods. Reuses the same submitted student-attendance
// sessions and the same canonical section-roster query
// (lib/students/sectionRoster.ts) - no separate/duplicate data source.
//
// Two callers share this route: HOD (their own department tree only - see
// canHodEditDepartment) and PRINCIPAL/VICE_PRINCIPAL (every department in the
// college, view-only - this route is GET-only regardless). The HOD path is
// unchanged from before Principal support was added.
//
// Drill levels, selected by which query params are present:
//   sectionId only                       -> { years: number[] }
//   sectionId + year                     -> { months: number[] }
//   sectionId + year + month             -> { dates: string[] }, newest first
//   sectionId + year + month + summary   -> { subjects, weekLabels, students } (see below) - "Month Report"
//   sectionId + year + month + date      -> { subjects, students, classwork }        (Monthly - unchanged)
//   sectionId + summary + from/to        -> { subjects, students } - "Period" (hod/monthly-records's own
//                                            Period tab - subjects derived from whatever sessions actually
//                                            fall in range, so a since-retired subject still shows up)
//   sectionId + summary + allTime        -> { subjects, students } - "Till now" (same page/shape as above)
//   sectionId + from + to (no summary)   -> { subjects, students, summary }          (a second, independently
//   sectionId + tillNow=true                built Period/Till-Now consumer - subjects instead fixed to the
//                                            section's CURRENT teaching-assignment roster, and each student
//                                            additionally carries `overall`, plus a section-wide `summary`
//                                            footer. Kept alongside the mode above rather than merged into
//                                            it since the two disagree on subject scope and response shape;
//                                            distinguished by the presence of `summary=true`, which this
//                                            mode never sends.)
// The `from`/`to`/`tillNow`/`summary` modes are all checked BEFORE the
// year/month/date drill chain and are mutually exclusive with it (the
// Monthly flow never sends them), so the existing Monthly behavior below is
// untouched either way.
//
// `subjects` is the section's CURRENT teaching-assignment roster (every
// subject an HOD has actually assigned to it, any faculty) - stable across
// dates, not filtered to "had a class that day", so the column set doesn't
// shift date to date. `classwork`/per-subject status only appear for
// subjects that actually had a submitted session on the selected date.
//
// `summary=true` (mutually exclusive with `date`) instead returns a whole
// month's Present/Total percentages per student per subject, broken down by
// week - the "Month Report" tab (see hod/monthly-records/.../[year]/[month]/
// page.tsx). Weeks follow the SAME Sun-Sat calendar-row boundaries as that
// page's own month-picker grid (a week can therefore be a partial one at
// either end of the month), not a naive "every 7 days from the 1st" - so a
// week's label always matches what the visible calendar shows as one row.
// `null` for a given subject/week means no class was actually held for it
// that week (never "0%" - a real 0% requires at least one held class the
// student missed).
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const { searchParams } = new URL(request.url);
    const sectionId = searchParams.get("sectionId");
    const yearParam = searchParams.get("year");
    const monthParam = searchParams.get("month");
    const dateParam = searchParams.get("date");
    // "Period"/"Till now" summary - see the two branches right after
    // `allSessions` below. Independent of the year/month drill levels
    // above; `allTime`/`tillNow` with neither `from` nor `to` means the
    // section's entire history. `summaryParam` distinguishes which of the
    // two independently-built Period/Till-Now modes a `from`/`to` pair
    // belongs to - see the drill-levels comment above.
    const summaryParam = searchParams.get("summary") === "true";
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const allTimeParam = searchParams.get("allTime") === "true";
    const tillNow = searchParams.get("tillNow") === "true";

    if (!sectionId) {
      return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    }
    // A reversed range wouldn't error out below - the date filter would
    // just never match anything, silently returning an empty (not wrong,
    // but confusing) report instead of the mistake it actually is. Caught
    // here as a backstop even though the picker page itself already
    // validates this, since this route is reachable directly by URL too.
    if (fromParam && toParam && fromParam > toParam) {
      return NextResponse.json({ error: "From date must be before the To date" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
    if (!sectionSnap.exists) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }
    const section = sectionSnap.data() as Section;

    // HOD stays scoped to their own department tree, exactly as before.
    // PRINCIPAL/VICE_PRINCIPAL have no department restriction - they can
    // report on any section in the college.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartment(scope, section.department)) {
        return NextResponse.json({ error: "This section isn't in your department" }, { status: 403 });
      }
    }

    const sessionsSnap = await collegeRef.collection("studentAttendance")
      .where("sectionId", "==", sectionId)
      .where("status", "==", "SUBMITTED")
      .get();
    const allSessions = sessionsSnap.docs.map((d) => d.data() as StudentAttendanceSession);

    // "Period" (from/to) or "Till now" (allTime, no bounds) - every student
    // x every subject's Held/Attend/% across an arbitrary range, mirroring
    // /api/college/student-attendance-history's own range logic but for the
    // whole section at once. Subjects are derived from whatever sessions
    // actually fall in range - not the CURRENT teaching-assignment roster
    // (see currentSectionSubjects, used by the month-scoped summary/date
    // branches below) - so a subject from an earlier semester/session still
    // appears in a long-enough Period or a Till-now report instead of
    // silently vanishing once teaching assignments move on. No weekly
    // breakdown (unlike the month summary below) - a range spanning more
    // than one month has no single calendar grid to align weeks against.
    // Gated on `summary=true` specifically so it never collides with the
    // independently-built Period/Till-Now mode right after it, which never
    // sends that flag.
    if (summaryParam && (fromParam || toParam || allTimeParam)) {
      const inRange = allSessions.filter((r) => {
        if (fromParam && r.date < fromParam) return false;
        if (toParam && r.date > toParam) return false;
        return true;
      });

      const subjectsMap = new Map<string, { subjectName: string; subjectCode: string }>();
      for (const r of inRange) {
        if (!subjectsMap.has(r.subjectId)) subjectsMap.set(r.subjectId, { subjectName: r.subjectName, subjectCode: r.subjectCode });
      }
      const subjects = Array.from(subjectsMap.entries())
        .map(([subjectId, v]) => ({ subjectId, subjectName: v.subjectName, subjectCode: v.subjectCode }))
        .sort((a, b) => a.subjectName.localeCompare(b.subjectName));

      // One session per subject per date (same dedupe as every other branch
      // here, in case a faculty ever double-submits).
      const sessionsBySubject = new Map<string, StudentAttendanceSession[]>();
      const seenSubjectDate = new Set<string>();
      for (const r of inRange) {
        const key = `${r.subjectId}|${r.date}`;
        if (seenSubjectDate.has(key)) continue;
        seenSubjectDate.add(key);
        const arr = sessionsBySubject.get(r.subjectId) ?? [];
        arr.push(r);
        sessionsBySubject.set(r.subjectId, arr);
      }

      const roster = await fetchSectionStudents(collegeRef, {
        department: section.department,
        sectionName: section.name,
        year: section.year,
        courseId: section.courseId,
      });

      const students = roster
        .map((stu) => {
          const bySubject: Record<string, { held: number; attend: number; percent: number | null }> = {};
          for (const sub of subjects) {
            let held = 0;
            let attend = 0;
            for (const r of sessionsBySubject.get(sub.subjectId) ?? []) {
              held += 1;
              if (r.entries.find((e) => e.studentId === stu.id)?.status === "PRESENT") attend += 1;
            }
            bySubject[sub.subjectId] = { held, attend, percent: held > 0 ? Math.round((attend / held) * 10000) / 100 : null };
          }
          return { id: stu.id, rollNumber: stu.rollNumber, name: stu.name, bySubject };
        })
        .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));

      return NextResponse.json({ subjects, students });
    }

    // A second, independently built Period/Till Now mode (bare `from`/`to`,
    // or `tillNow=true`, never `summary=true`) - attendance % per subject
    // (and overall) per student, computed from every SUBMITTED session (any
    // date, any period) in range - not scoped to one calendar day like the
    // Monthly drill-down below, and never carrying forward/merging periods
    // (each submitted session is already one independently-held period -
    // see types/studentAttendance.ts's doc id). Kept alongside the mode
    // above rather than merged into it: this one fixes its subject list to
    // the section's CURRENT teaching-assignment roster (via
    // currentSectionSubjects) rather than deriving it from sessions in
    // range, and shapes each student's per-subject stats and the response's
    // own section-wide `summary` footer differently.
    if (tillNow || (fromParam && toParam)) {
      if (!tillNow && (!DATE_RE.test(fromParam!) || !DATE_RE.test(toParam!))) {
        return NextResponse.json({ error: "from and to must be valid dates (YYYY-MM-DD)" }, { status: 400 });
      }
      const rangeSessions = tillNow
        ? allSessions
        : allSessions.filter((r) => r.date >= fromParam! && r.date <= toParam!);

      const subjects = await currentSectionSubjects(collegeRef, sectionId);
      const sessionsBySubject = new Map<string, StudentAttendanceSession[]>();
      for (const r of rangeSessions) {
        if (!sessionsBySubject.has(r.subjectId)) sessionsBySubject.set(r.subjectId, []);
        sessionsBySubject.get(r.subjectId)!.push(r);
      }

      const roster = await fetchSectionStudents(collegeRef, {
        department: section.department,
        sectionName: section.name,
        year: section.year,
        courseId: section.courseId,
      });

      const students = roster
        .map((stu) => {
          let overallHeld = 0;
          let overallAttended = 0;
          const bySubject: Record<string, { held: number; attended: number; percentage: number }> = {};
          for (const s of subjects) {
            const sessionsForSubject = sessionsBySubject.get(s.subjectId) ?? [];
            const held = sessionsForSubject.length;
            const attended = sessionsForSubject.filter(
              (r) => r.entries.find((e) => e.studentId === stu.id)?.status === "PRESENT"
            ).length;
            const percentage = held > 0 ? Math.round((attended / held) * 100) : 0;
            bySubject[s.subjectId] = { held, attended, percentage };
            overallHeld += held;
            overallAttended += attended;
          }
          const overallPercentage = overallHeld > 0 ? Math.round((overallAttended / overallHeld) * 100) : 0;
          return {
            studentId: stu.id,
            rollNumber: stu.rollNumber,
            name: stu.name,
            bySubject,
            overall: { held: overallHeld, attended: overallAttended, percentage: overallPercentage },
          };
        })
        .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));

      // Section-wide summary for the "Total Attendance" footer - Held is a
      // period count (sum of every subject's held sessions, same for every
      // student); Attended/Percentage are marks-based (sum of presentCount /
      // totalStudents across every session in range, using each session's
      // own stored roster size rather than today's roster - robust to
      // students joining/leaving mid-range, same approach as the Faculty
      // Attendance Report's subject-percentage feature).
      const totalPeriodsHeld = subjects.reduce((sum, s) => sum + (sessionsBySubject.get(s.subjectId)?.length ?? 0), 0);
      const totalPresentMarks = rangeSessions.reduce((sum, r) => sum + r.presentCount, 0);
      const totalPossibleMarks = rangeSessions.reduce((sum, r) => sum + r.totalStudents, 0);
      const summary = {
        totalPeriodsHeld,
        totalPeriodsAttended: totalPresentMarks,
        overallPercentage: totalPossibleMarks > 0 ? Math.round((totalPresentMarks / totalPossibleMarks) * 100) : 0,
      };

      return NextResponse.json({ subjects, students, summary });
    }

    if (!yearParam) {
      const years = Array.from(new Set(allSessions.map((r) => Number(r.date.slice(0, 4))))).sort((a, b) => b - a);
      return NextResponse.json({ years });
    }

    const year = Number(yearParam);
    const inYear = allSessions.filter((r) => Number(r.date.slice(0, 4)) === year);

    if (!monthParam) {
      const months = Array.from(new Set(inYear.map((r) => Number(r.date.slice(5, 7))))).sort((a, b) => a - b);
      return NextResponse.json({ months });
    }

    const monthStr = String(Number(monthParam)).padStart(2, "0");
    const inMonth = inYear.filter((r) => r.date.slice(5, 7) === monthStr);

    if (summaryParam && !dateParam) {
      const subjects = await currentSectionSubjects(collegeRef, sectionId);

      // Sun-Sat calendar-row week boundaries for this month, matching the
      // month-picker grid on the page that consumes this - week 0 starts
      // wherever day 1 falls in its own Sun-Sat row, so the first and last
      // week can be partial.
      const daysInMonth = new Date(year, Number(monthParam), 0).getDate();
      const firstWeekday = new Date(year, Number(monthParam) - 1, 1).getDay(); // 0 = Sunday
      const lastWeekIndex = Math.floor((daysInMonth - 1 + firstWeekday) / 7);
      const weekRanges = Array.from({ length: lastWeekIndex + 1 }, (_, w) => {
        const startDay = Math.max(1, w * 7 - firstWeekday + 1);
        const endDay = Math.min(daysInMonth, (w + 1) * 7 - firstWeekday);
        return { startDay, endDay, label: startDay === endDay ? `${startDay}` : `${startDay}–${endDay}` };
      });
      const weekIndexForDate = (dateStr: string) => {
        const day = Number(dateStr.slice(8, 10));
        return Math.floor((day - 1 + firstWeekday) / 7);
      };

      // One session per subject per date (same "first one wins" dedupe as
      // the single-date branch below, in case a faculty ever double-submits).
      const sessionsBySubject = new Map<string, StudentAttendanceSession[]>();
      const seenSubjectDate = new Set<string>();
      for (const r of inMonth) {
        const key = `${r.subjectId}|${r.date}`;
        if (seenSubjectDate.has(key)) continue;
        seenSubjectDate.add(key);
        const arr = sessionsBySubject.get(r.subjectId) ?? [];
        arr.push(r);
        sessionsBySubject.set(r.subjectId, arr);
      }

      const roster = await fetchSectionStudents(collegeRef, {
        department: section.department,
        sectionName: section.name,
        year: section.year,
        courseId: section.courseId,
      });

      const students = roster
        .map((stu) => {
          const bySubject: Record<string, { weeks: (number | null)[]; monthPresent: number; monthTotal: number; monthPercent: number | null }> = {};
          for (const sub of subjects) {
            const weekPresent = new Array(weekRanges.length).fill(0) as number[];
            const weekTotal = new Array(weekRanges.length).fill(0) as number[];
            for (const r of sessionsBySubject.get(sub.subjectId) ?? []) {
              const wi = weekIndexForDate(r.date);
              weekTotal[wi] += 1;
              if (r.entries.find((e) => e.studentId === stu.id)?.status === "PRESENT") weekPresent[wi] += 1;
            }
            const weeks = weekPresent.map((p, i) => (weekTotal[i] > 0 ? Math.round((p / weekTotal[i]) * 100) : null));
            const monthTotal = weekTotal.reduce((a, b) => a + b, 0);
            const monthPresent = weekPresent.reduce((a, b) => a + b, 0);
            bySubject[sub.subjectId] = {
              weeks, monthPresent, monthTotal,
              monthPercent: monthTotal > 0 ? Math.round((monthPresent / monthTotal) * 100) : null,
            };
          }
          return { id: stu.id, rollNumber: stu.rollNumber, name: stu.name, bySubject };
        })
        .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));

      return NextResponse.json({ subjects, weekLabels: weekRanges.map((w) => w.label), students });
    }

    if (!dateParam) {
      const dates = Array.from(new Set(inMonth.map((r) => r.date))).sort((a, b) => b.localeCompare(a));
      return NextResponse.json({ dates });
    }

    // Every subject currently assigned to this section, any faculty - the
    // report's stable column set.
    const subjects = await currentSectionSubjects(collegeRef, sectionId);

    const dayRecords = inMonth.filter((r) => r.date === dateParam);
    const sessionBySubject = new Map<string, StudentAttendanceSession>();
    for (const r of dayRecords) {
      if (!sessionBySubject.has(r.subjectId)) sessionBySubject.set(r.subjectId, r);
    }

    const classwork = subjects
      .filter((s) => sessionBySubject.has(s.subjectId))
      .map((s) => {
        const r = sessionBySubject.get(s.subjectId)!;
        return { subjectId: s.subjectId, subjectName: s.subjectName, classNotes: r.classNotes ?? "" };
      });

    const roster = await fetchSectionStudents(collegeRef, {
      department: section.department,
      sectionName: section.name,
      year: section.year,
      courseId: section.courseId,
    });

    const students = roster
      .map((stu) => {
        const statusBySubject: Record<string, StudentAttendanceMark | null> = {};
        for (const s of subjects) {
          const r = sessionBySubject.get(s.subjectId);
          const entry = r?.entries.find((e) => e.studentId === stu.id);
          statusBySubject[s.subjectId] = entry?.status ?? null;
        }
        return { id: stu.id, rollNumber: stu.rollNumber, name: stu.name, statusBySubject };
      })
      .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));

    return NextResponse.json({ subjects, students, classwork });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/section-attendance-report GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
