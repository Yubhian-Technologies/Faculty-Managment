import type { Firestore } from "firebase-admin/firestore";
import { canHodEditDepartment, facultyManageableDepartmentNames, getHodDepartmentScope } from "@/lib/departments/scope";
import { getFacultyPeriodsForDate } from "@/lib/timetable/currentPeriod";
import { whereIn } from "@/lib/firestore/inQuery";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { nowInIndia } from "@/lib/leave/dayCounter";
import { REQUESTS_COL } from "@/lib/leave/balanceEngine";
import { istDateKey } from "@/lib/attendance/istTime";
import { toDate } from "@/lib/utils";
import { loadEffectiveTiming, matchesCurrentSemester, resolveCurrentSemester } from "@/lib/college/semester";
import { loadAcademicYearConfig, sessionInAcademicYear, windowForAcademicYear } from "@/lib/studentAttendance/academicYearWindow";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import { indexSessions, tallyStudentBySubject } from "@/lib/studentAttendance/counting";
import { effectiveJoiningDate } from "@/lib/studentAttendance/joiningDate";
import { calcPercent } from "@/lib/studentAttendance/percentage";
import { isFacultyAvailable } from "@/types";
import type { CourseYearTiming, FacultyMember, Section, StudentAttendanceSession, TeachingAssignment } from "@/types";
import type { LeaveRequest } from "@/types/leave";
import type { ExamResultBatch, ExamResultRecord } from "@/types/examResults";
import {
  classStatus, dailyTrend, mergeCell, passRate, sectionAttendanceToday, yearRoman, type ClassCell,
} from "./hodDashboard";

// Loads the HOD dashboard (GET /api/college/hod/dashboard). Everything is limited to the HOD's own department tree:
// sections the HOD may report on (canHodEditDepartment, the same check as the attendance reports) and the faculty
// they manage (facultyManageableDepartmentNames) plus anyone teaching those sections. Counting follows the reports:
// posted sessions' own marks, on duty left out, Date of Joining respected.

type Db = Firestore;
const SHORT = 75;
const CRITICAL = 65;

interface ScopedSection { id: string; name: string; label: string; department: string; year: number; courseId: string }

async function scopedSections(db: Db, collegeId: string, uid: string) {
  const scope = await getHodDepartmentScope(db, collegeId, uid);
  const snap = await db.collection("colleges").doc(collegeId).collection("sections").get();
  const sections: ScopedSection[] = snap.docs
    .map((d) => ({ ...(d.data() as Section), id: d.id }))
    .filter((s) => s.department && canHodEditDepartment(scope, s.department))
    .map((s) => ({ id: s.id, name: s.name, label: `${yearRoman(Number(s.year))}-${s.name}`, department: s.department, year: Number(s.year), courseId: s.courseId }))
    .sort((a, b) => a.department.localeCompare(b.department) || a.year - b.year || a.name.localeCompare(b.name));
  return { scope, sections };
}

const chunk = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

// ── Today ───────────────────────────────────────────────────────────────────

// Today's figures are kept 60 seconds per HOD (the page refreshes every 5 minutes; several tabs share one read).
const todayCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof computeToday>> }>();

export async function loadHodToday(db: Db, collegeId: string, uid: string) {
  const key = `${collegeId}:${uid}`;
  const hit = todayCache.get(key);
  if (hit && Date.now() - hit.at < 60_000 && !process.env.FIRESTORE_EMULATOR_HOST) return hit.value;
  const value = await computeToday(db, collegeId, uid);
  todayCache.set(key, { at: Date.now(), value });
  return value;
}

async function computeToday(db: Db, collegeId: string, uid: string) {
  const { dateISO: today, timeHHMM: now } = nowInIndia();
  const collegeRef = db.collection("colleges").doc(collegeId);
  const { scope, sections } = await scopedSections(db, collegeId, uid);
  const sectionIds = new Set(sections.map((s) => s.id));
  const facultyDepts = facultyManageableDepartmentNames(scope);

  const [deptFacultySnap, assignmentSnaps, sessionsSnap, leaveSnap] = await Promise.all([
    facultyDepts.length ? whereIn(collegeRef.collection("facultyMembers"), "department", facultyDepts).get() : Promise.resolve(null),
    Promise.all(chunk([...sectionIds], 30).map((ids) => collegeRef.collection("teachingAssignments").where("sectionId", "in", ids).select("facultyId", "isPast").get())),
    collegeRef.collection("studentAttendance").where("date", "==", today).where("status", "==", "SUBMITTED").get(),
    REQUESTS_COL(collegeId, db).where("status", "==", "APPROVED").get(),
  ]);

  // Department faculty + whoever teaches the department's sections (another department's faculty teaching here).
  const faculty = new Map<string, FacultyMember & { id: string }>();
  for (const d of deptFacultySnap?.docs ?? []) {
    const f = { ...(d.data() as FacultyMember), id: d.id };
    if (isFacultyAvailable(f.status)) faculty.set(d.id, f);
  }
  const teaching = new Set<string>();
  for (const s of assignmentSnaps) for (const d of s.docs) {
    const a = d.data() as Pick<TeachingAssignment, "facultyId" | "isPast">;
    if (!a.isPast && a.facultyId && !faculty.has(a.facultyId)) teaching.add(a.facultyId);
  }
  if (teaching.size) {
    const docs = await db.getAll(...[...teaching].map((id) => collegeRef.collection("facultyMembers").doc(id)));
    for (const d of docs) if (d.exists) faculty.set(d.id, { ...(d.data() as FacultyMember), id: d.id });
  }

  // Posted today, by section + period.
  const sessions = sessionsSnap.docs.map((d) => d.data() as StudentAttendanceSession).filter((s) => !!s.sectionId && sectionIds.has(s.sectionId));
  const postedKeys = new Set(sessions.map((s) => `${s.sectionId}|${s.periodNumber}`));
  const asToday = (list: StudentAttendanceSession[]) => list.map((s) => ({ sectionId: s.sectionId ?? "", date: s.date, periodNumber: s.periodNumber, entries: s.entries ?? [] }));

  // Every faculty member's periods today (substitutes and class adjustments included) -> the section x period grid.
  const cells: Record<string, ClassCell> = {};
  const periodsByFaculty = new Map<string, { periodNumber: number; sectionId: string }[]>();
  const timingCache = new Map();
  // 24 faculty at a time: each is a few small timetable reads, and the dashboard waits for all of them.
  for (const ids of chunk([...faculty.keys()], 24)) {
    const lists = await Promise.all(ids.map((id) => getFacultyPeriodsForDate(db, collegeId, id, today, timingCache).catch(() => [])));
    lists.forEach((list, i) => {
      const f = faculty.get(ids[i])!;
      for (const p of list) {
        const sectionId = p.slot.sectionId ?? "";
        const periodNumber = p.slot.periodNumber;
        periodsByFaculty.set(ids[i], [...(periodsByFaculty.get(ids[i]) ?? []), { periodNumber, sectionId }]);
        if (!sectionIds.has(sectionId)) continue;
        const key = `${sectionId}|${periodNumber}`;
        cells[key] = mergeCell(cells[key], {
          status: classStatus(postedKeys.has(key), p.startTime, p.endTime, now),
          covered: !!p.adjustedFrom || !!p.attendanceOnly,
          subject: p.slot.subjectName || "",
          faculty: facultyDisplayName(f),
          start: p.startTime, end: p.endTime,
        });
      }
    });
  }
  // A posted period with no timetable slot (an extra class) still shows as posted.
  for (const s of sessions) {
    const key = `${s.sectionId}|${s.periodNumber}`;
    if (!cells[key]) cells[key] = { status: "POSTED", covered: false, subject: s.subjectCode || s.subjectName || "", faculty: s.facultyName ?? "", start: "", end: "" };
  }

  const all = Object.values(cells);
  const periods = [...new Set(Object.keys(cells).map((k) => Number(k.split("|")[1])))].filter(Number.isFinite).sort((a, b) => a - b);
  const gridSections = sections.filter((s) => periods.some((p) => cells[`${s.id}|${p}`]));
  const running = all.filter((c) => c.status === "NOW");
  const upcoming = all.filter((c) => c.status === "UPCOMING").sort((a, b) => a.start.localeCompare(b.start));
  const overdue = Object.entries(cells)
    .filter(([, c]) => c.status === "OVERDUE")
    .map(([k, c]) => {
      const [sid, p] = k.split("|");
      return { section: sections.find((s) => s.id === sid)?.label ?? "", period: Number(p), subject: c.subject, faculty: c.faculty, end: c.end };
    })
    .sort((a, b) => a.period - b.period || a.section.localeCompare(b.section));

  // Students today, per section.
  const byId = new Map(sections.map((s) => [s.id, s]));
  const sectionRows = sectionAttendanceToday(asToday(sessions))
    .map((r) => ({ ...r, label: byId.get(r.sectionId)?.label ?? "", department: byId.get(r.sectionId)?.department ?? "" }))
    .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));
  const counted = sectionRows.reduce((n, r) => n + r.counted, 0);
  const present = sectionRows.reduce((n, r) => n + r.present, 0);

  // On leave today, and who covers their periods.
  const facultyByUid = new Map([...faculty.values()].filter((f) => f.userUid).map((f) => [f.userUid!, f]));
  const onLeave = leaveSnap.docs
    .map((d) => ({ ...(d.data() as LeaveRequest), id: d.id }))
    .filter((r) => r.department && facultyDepts.includes(r.department))
    .filter((r) => {
      const from = toDate(r.fromDate), to = toDate(r.toDate);
      return !!from && !!to && istDateKey(from) <= today && istDateKey(to) >= today;
    })
    .map((r) => {
      const subs = (r.periodSubstitutions ?? []).filter((p) => p.date === today);
      const f = facultyByUid.get(r.uid);
      const mine = f ? (periodsByFaculty.get(f.id) ?? []) : [];
      const coveredPeriods = new Set(subs.map((p) => p.periodNumber));
      return {
        name: r.employeeName,
        leaveType: r.leaveTypeCode ?? "OTHER",
        halfDay: r.isHalfDay ? (r.halfDaySession ?? "FN") : null,
        covers: subs.map((p) => ({ period: p.periodNumber, section: p.sectionName ?? "", substitute: p.substituteFacultyName })),
        uncovered: mine.filter((p) => !coveredPeriods.has(p.periodNumber)).length,
      };
    })
    .sort((a, b) => b.uncovered - a.uncovered || a.name.localeCompare(b.name));

  const nowCell = running.sort((a, b) => a.start.localeCompare(b.start))[0];
  return {
    date: today,
    now,
    current: nowCell ? { start: nowCell.start, end: nowCell.end } : upcoming[0] ? { next: true, start: upcoming[0].start, end: upcoming[0].end } : null,
    classes: {
      periods,
      sections: gridSections.map((s) => ({ id: s.id, label: s.label, department: s.department })),
      cells,
      due: all.filter((c) => c.status !== "UPCOMING").length,
      posted: all.filter((c) => c.status === "POSTED").length,
      running: running.length,
      overdue,
      total: all.length,
    },
    students: {
      pct: counted ? Math.round((present / counted) * 1000) / 10 : null,
      absentAllDay: sectionRows.reduce((n, r) => n + r.absentAllDay, 0),
      sections: sectionRows,
    },
    onLeave,
    departments: [...new Set(sections.map((s) => s.department))],
  };
}

// ── This semester (cached 10 minutes per HOD) ───────────────────────────────

const semesterCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof computeSemester>> }>();
const TEN_MINUTES = 10 * 60_000;

export async function loadHodSemester(db: Db, collegeId: string, uid: string, fresh = false) {
  const key = `${collegeId}:${uid}`;
  const hit = semesterCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TEN_MINUTES && !process.env.FIRESTORE_EMULATOR_HOST) return hit.value;
  const value = await computeSemester(db, collegeId, uid);
  semesterCache.set(key, { at: Date.now(), value });
  return value;
}

async function computeSemester(db: Db, collegeId: string, uid: string) {
  const today = nowInIndia().dateISO;
  const collegeRef = db.collection("colleges").doc(collegeId);
  const { scope, sections } = await scopedSections(db, collegeId, uid);
  const cfg = await loadAcademicYearConfig(db, collegeId);
  const window = windowForAcademicYear(cfg.currentLabel, cfg);

  const timingCache = new Map<string, Promise<CourseYearTiming | null>>();
  const timingOf = (courseId: string, year: number) => {
    const k = `${courseId}_${year}`;
    if (!timingCache.has(k)) timingCache.set(k, loadEffectiveTiming(db, collegeId, courseId, year).catch(() => null));
    return timingCache.get(k)!;
  };

  const allSessions: StudentAttendanceSession[] = [];
  let students = 0, below = 0, critical = 0;
  const criticalList: { name: string; rollNumber: string; section: string; pct: number }[] = [];
  const subjectShort = new Map<string, { label: string; name: string; below: number }>();
  let semesterStart: string | null = null;

  for (const group of chunk(sections, 6)) {
    await Promise.all(group.map(async (sec) => {
      const timing = await timingOf(sec.courseId, sec.year);
      const current = resolveCurrentSemester(timing, new Date());
      const startRaw = timing?.semesters?.find((x) => x.semester === current)?.startDate;
      const start = startRaw ? toDate(startRaw) : null;
      const startKey = start ? istDateKey(start) : null;
      if (startKey && (!semesterStart || startKey < semesterStart)) semesterStart = startKey;
      let q: FirebaseFirestore.Query = collegeRef.collection("studentAttendance").where("sectionId", "==", sec.id).where("status", "==", "SUBMITTED");
      const from = startKey ?? window?.from;
      if (from) q = q.where("date", ">=", from);
      q = q.where("date", "<=", today);
      const [snap, roster] = await Promise.all([
        q.get(),
        fetchSectionStudents(collegeRef, { department: sec.department, sectionName: sec.name, year: sec.year, courseId: sec.courseId }),
      ]);
      const list = snap.docs.map((d) => d.data() as StudentAttendanceSession)
        .filter((r) => matchesCurrentSemester(r.semester, current) && sessionInAcademicYear(r, window ?? null));
      allSessions.push(...list);
      const names = new Map(list.map((r) => [r.subjectId, { code: r.subjectCode || r.subjectName || "", name: r.subjectName || "" }]));
      const indexed = indexSessions(list);
      for (const stu of roster) {
        const tallies = tallyStudentBySubject(indexed, stu.id, effectiveJoiningDate(stu));
        let held = 0, attended = 0;
        for (const [sid, t] of tallies) {
          held += t.held; attended += t.attended;
          const p = calcPercent(t.attended, t.held);
          if (p != null && p < SHORT) {
            const n = names.get(sid);
            const cur = subjectShort.get(sid) ?? { label: n?.code ?? "", name: n?.name ?? "", below: 0 };
            cur.below += 1;
            subjectShort.set(sid, cur);
          }
        }
        const pct = calcPercent(attended, held);
        if (pct == null) continue;
        students += 1;
        if (pct < SHORT) below += 1;
        if (pct < CRITICAL) {
          critical += 1;
          criticalList.push({ name: stu.name, rollNumber: stu.rollNumber, section: sec.label, pct });
        }
      }
    }));
  }

  // Latest published Regular results per year of study.
  const batchesSnap = await collegeRef.collection("semesterResultBatches").where("status", "==", "PUBLISHED").where("examType", "==", "REGULAR").get();
  const batches = batchesSnap.docs.map((d) => ({ ...(d.data() as ExamResultBatch), id: d.id })).filter((b) => b.department && canHodEditDepartment(scope, b.department));
  const latestByYear = new Map<number, { examHeld: string; semester: number }>();
  for (const b of batches) {
    const cur = latestByYear.get(b.year);
    if (!cur || b.examHeld > cur.examHeld || (b.examHeld === cur.examHeld && b.semester > cur.semester)) latestByYear.set(b.year, { examHeld: b.examHeld, semester: b.semester });
  }
  const results = await Promise.all([...latestByYear.entries()].sort((a, b) => a[0] - b[0]).map(async ([year, l]) => {
    const ids = batches.filter((b) => b.year === year && b.examHeld === l.examHeld && b.semester === l.semester).map((b) => b.id);
    const snaps = await Promise.all(chunk(ids, 30).map((c) => collegeRef.collection("semesterResults").where("batchId", "in", c).select("subjects").get()));
    const rate = passRate(snaps.flatMap((s) => s.docs.map((d) => d.data() as Pick<ExamResultRecord, "subjects">)));
    return { year, label: `${yearRoman(year)} Year`, semester: l.semester, examHeld: l.examHeld, ...rate };
  }));

  return {
    since: semesterStart ?? window?.from ?? null,
    trend: dailyTrend(allSessions.map((x) => ({ sectionId: x.sectionId ?? "", date: x.date, entries: x.entries ?? [] })), 14, today),
    shortage: {
      students, below, critical,
      criticalList: criticalList.sort((a, b) => a.pct - b.pct).slice(0, 12),
      bySubject: [...subjectShort.values()].filter((x) => x.below > 0).sort((a, b) => b.below - a.below).slice(0, 6),
    },
    results: results.filter((r) => r.students > 0),
    computedAt: new Date().toISOString(),
  };
}
