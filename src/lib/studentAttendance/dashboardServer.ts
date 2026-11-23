import type { Firestore } from "firebase-admin/firestore";
import { cacheKey, scopedSections, type DashScope, type ScopedSection } from "@/lib/dashboard/hodDashboardServer";
import { nowInIndia } from "@/lib/leave/dayCounter";
import { istDateKey } from "@/lib/attendance/istTime";
import { toDate } from "@/lib/utils";
import { loadEffectiveTiming, matchesCurrentSemester, resolveCurrentSemester } from "@/lib/college/semester";
import { loadAcademicYearConfig, sessionInAcademicYear, windowForAcademicYear } from "@/lib/studentAttendance/academicYearWindow";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import { effectiveJoiningDate } from "@/lib/studentAttendance/joiningDate";
import { compareRollNumbers } from "@/lib/students/listOrder";
import type { CourseYearTiming, StudentAttendanceSession } from "@/types";
import {
  addDays, indexDashSessions, markFigures, rangeWindow, sectionFigures, studentFigures,
  type DashRange, type DashSession, type StudentFigures,
} from "./dashboard";

// The Student Attendance dashboard (GET /api/college/student-attendance/dashboard): an HOD's department tree (the same
// sections as the HOD dashboard and the reports) or the whole college for the Principal / VP, narrowed by department,
// year and section, over the current semester, this month, the last 30 days or picked dates. Reads each section's
// SUBMITTED sessions once (from two weeks before the range when needed, for the "last 2 weeks" figures) and its roster.

type Db = Firestore;
const SHORT = 75;
const CRITICAL = 65;
const DROP = 10;
const STREAK = 3;
const MAX_LIST = 500;

export interface DashParams {
  range: DashRange;
  from?: string;
  to?: string;
  department?: string;
  year?: number;
  sectionId?: string;
}

const cache = new Map<string, { at: number; value: Awaited<ReturnType<typeof compute>> }>();
const FIVE_MINUTES = 5 * 60_000;

export async function loadAttendanceDashboard(db: Db, collegeId: string, who: DashScope, p: DashParams, fresh = false) {
  const key = `${await cacheKey(collegeId, who)}|${JSON.stringify(p)}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < FIVE_MINUTES && !process.env.FIRESTORE_EMULATOR_HOST) return hit.value;
  const value = await compute(db, collegeId, who, p);
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return value;
}

const chunk = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

async function compute(db: Db, collegeId: string, who: DashScope, p: DashParams) {
  const today = nowInIndia().dateISO;
  const collegeRef = db.collection("colleges").doc(collegeId);
  const { sections: scoped } = await scopedSections(db, collegeId, who);
  const sections = scoped.filter((s) => (!p.department || s.department === p.department) && (!p.year || s.year === p.year) && (!p.sectionId || s.id === p.sectionId));
  const fixed = rangeWindow(p.range, today, { from: p.from, to: p.to });
  const cfg = await loadAcademicYearConfig(db, collegeId);
  const window = windowForAcademicYear(cfg.currentLabel, cfg);

  const timingCache = new Map<string, Promise<CourseYearTiming | null>>();
  const timingOf = (courseId: string, year: number) => {
    const k = `${courseId}_${year}`;
    if (!timingCache.has(k)) timingCache.set(k, loadEffectiveTiming(db, collegeId, courseId, year).catch(() => null));
    return timingCache.get(k)!;
  };

  const allSessions: DashSession[] = [];
  const sectionRows: { id: string; label: string; department: string; year: number; strength: number; classes: number; pct: number | null; todayPct: number | null; below: number; change: number | null }[] = [];
  const watch: { studentId: string; sectionId: string; name: string; rollNumber: string; section: string; department: string; pct: number | null; change: number | null; streak: number; mentor: string | null; mobile: string | null; held: number; attended: number }[] = [];
  let students = 0, below = 0, critical = 0, absentToday = 0, streaks = 0, drops = 0;
  let since: string | null = fixed.from;

  // 12 sections at a time: each is two reads, and the whole college (the Principal's default) is ~70 sections.
  for (const group of chunk(sections, 12)) {
    await Promise.all(group.map(async (sec: ScopedSection) => {
      let from = fixed.from;
      let current: number | null = null;
      if (p.range === "semester") {
        const timing = await timingOf(sec.courseId, sec.year);
        current = resolveCurrentSemester(timing, new Date());
        const startRaw = timing?.semesters?.find((x) => x.semester === current)?.startDate;
        const start = startRaw ? toDate(startRaw) : null;
        from = start ? istDateKey(start) : window?.from ?? addDays(today, -120);
        if (!since || from < since) since = from;
      }
      const to = fixed.to;
      const readFrom = from! < addDays(to, -13) ? from! : addDays(to, -13);
      const [snap, roster] = await Promise.all([
        collegeRef.collection("studentAttendance").where("sectionId", "==", sec.id).where("status", "==", "SUBMITTED")
          .where("date", ">=", readFrom).where("date", "<=", to)
          .select("date", "periodNumber", "subjectId", "subjectName", "subjectCode", "facultyName", "entries", "semester", "academicYear").get(),
        fetchSectionStudents(collegeRef, { department: sec.department, sectionName: sec.name, year: sec.year, courseId: sec.courseId }),
      ]);
      const list: DashSession[] = snap.docs.map((d) => d.data() as StudentAttendanceSession)
        .filter((r) => (current == null || matchesCurrentSemester(r.semester, current)) && (p.range !== "semester" || sessionInAcademicYear(r, window ?? null)))
        .map((r) => ({
          sectionId: sec.id, date: r.date, periodNumber: r.periodNumber, subjectId: r.subjectId, subjectName: r.subjectName,
          subjectCode: r.subjectCode, facultyName: r.facultyName, entries: (r.entries ?? []).map((e) => ({ studentId: e.studentId, status: e.status ?? null })),
        }));
      allSessions.push(...list.filter((x) => x.date >= from!));
      const indexed = indexDashSessions(list);
      const figures: StudentFigures[] = [];
      const todayTally = { held: 0, attended: 0 };
      for (const x of list) if (x.date === today) for (const e of x.entries) {
        if (e.status === "ON_DUTY") continue;
        todayTally.held += 1;
        if (e.status === "PRESENT") todayTally.attended += 1;
      }
      for (const stu of roster) {
        const f = studentFigures(indexed, stu.id, from!, to, effectiveJoiningDate(stu));
        figures.push(f);
        if (f.pct == null && !f.absentToday && f.absentStreak < STREAK) continue;
        if (f.pct != null) {
          students += 1;
          if (f.pct < SHORT) below += 1;
          if (f.pct < CRITICAL) critical += 1;
        }
        if (f.absentToday && to === today) absentToday += 1;
        const change = f.recentPct != null && f.earlierPct != null ? Math.round((f.recentPct - f.earlierPct) * 10) / 10 : null;
        const isStreak = f.absentStreak >= STREAK;
        const isDrop = change != null && change <= -DROP;
        if (isStreak) streaks += 1;
        if (isDrop) drops += 1;
        if ((f.pct != null && f.pct < SHORT) || isStreak || isDrop) {
          const s = stu as { mentorName?: string; mobileNo?: string };
          watch.push({
            studentId: stu.id, sectionId: sec.id, name: stu.name, rollNumber: stu.rollNumber, section: sec.label, department: sec.department,
            pct: f.pct, change, streak: f.absentStreak, mentor: s.mentorName ?? null, mobile: s.mobileNo ? String(s.mobileNo) : null,
            held: f.held, attended: f.attended,
          });
        }
      }
      // Classes posted in the range (a 0% from a single class reads very differently from one over a whole semester).
      const classes = new Set(list.filter((x) => x.date >= from!).map((x) => `${x.date}|${x.periodNumber}|${x.subjectId}`)).size;
      sectionRows.push({ id: sec.id, label: sec.label, department: sec.department, year: sec.year, strength: roster.length, classes, ...sectionFigures(figures, todayTally, SHORT) });
    }));
  }

  const marks = markFigures(allSessions, since ?? addDays(today, -120), fixed.to, today);
  const todayMarks = allSessions.filter((x) => x.date === today).reduce((t, x) => {
    for (const e of x.entries) { if (e.status === "ON_DUTY") continue; t.held += 1; if (e.status === "PRESENT") t.attended += 1; }
    return t;
  }, { held: 0, attended: 0 });
  const rangeT = allSessions.reduce((t, x) => {
    for (const e of x.entries) { if (e.status === "ON_DUTY") continue; t.held += 1; if (e.status === "PRESENT") t.attended += 1; }
    return t;
  }, { held: 0, attended: 0 });
  const pct = (a: number, h: number) => (h ? Math.round((a / h) * 1000) / 10 : null);
  const byRoll = (a: { rollNumber: string }, b: { rollNumber: string }) => compareRollNumbers(a.rollNumber, b.rollNumber);

  return {
    today,
    from: since,
    to: fixed.to,
    // Every section in scope (not just the filtered ones), so the page can offer its pickers.
    options: scoped.map((s) => ({ id: s.id, label: s.label, name: s.name, department: s.department, year: s.year })),
    kpis: {
      todayPct: fixed.to === today ? pct(todayMarks.attended, todayMarks.held) : null,
      rangePct: pct(rangeT.attended, rangeT.held),
      students, below, critical, absentToday, streaks, drops,
    },
    trend: marks.trend.slice(-30),
    weekdays: marks.weekdays,
    periods: fixed.to === today ? marks.periods : [],
    subjects: marks.subjects,
    sections: sectionRows.sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101) || a.label.localeCompare(b.label)),
    watch: {
      critical: watch.filter((w) => w.pct != null && w.pct < CRITICAL).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0) || byRoll(a, b)).slice(0, MAX_LIST),
      below: watch.filter((w) => w.pct != null && w.pct < SHORT).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0) || byRoll(a, b)).slice(0, MAX_LIST * 4),
      streak: watch.filter((w) => w.streak >= STREAK).sort((a, b) => b.streak - a.streak || byRoll(a, b)).slice(0, MAX_LIST),
      dropped: watch.filter((w) => w.change != null && w.change <= -DROP).sort((a, b) => (a.change ?? 0) - (b.change ?? 0) || byRoll(a, b)).slice(0, MAX_LIST),
    },
    computedAt: new Date().toISOString(),
  };
}
