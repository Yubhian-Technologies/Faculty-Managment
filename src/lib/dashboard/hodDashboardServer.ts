import type { Firestore } from "firebase-admin/firestore";
import { leavePartOn, partCovers } from "@/lib/leave/leaveDayParts";
import { canHodEditDepartment, facultyManageableDepartmentNames, getHodDepartmentScope } from "@/lib/departments/scope";
import { canHodEditDepartmentYear, type DepartmentYearRow } from "@/lib/departments/managedBranches";
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
import { indexSessions, isOnDutyMark, tallyStudentBySubject } from "@/lib/studentAttendance/counting";
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
// The longest list a number card's detail window carries (the whole college for the Principal).
const MAX_DETAIL_ROWS = 3000;

interface ScopedSection { id: string; name: string; label: string; department: string; year: number; courseId: string }

/** Whose dashboard: an HOD's department tree, or the whole college (Principal / VP / College Admin). */
export type DashScope = { kind: "hod"; uid: string } | { kind: "college" };

async function scopedSections(db: Db, collegeId: string, who: DashScope) {
  const scope = who.kind === "hod" ? await getHodDepartmentScope(db, collegeId, who.uid) : null;
  const canSee = (department: string) => !scope || canHodEditDepartment(scope, department);
  const facultyDepts = scope ? facultyManageableDepartmentNames(scope) : null;
  const college = db.collection("colleges").doc(collegeId);
  const [snap, deptSnap, courseSnap] = await Promise.all([
    college.collection("sections").get(),
    scope ? college.collection("departments").get() : null,
    scope ? college.collection("courses").select("catalogId").get() : null,
  ]);
  // Year by year, like the reports: a 1st-year (shared year) HOD who manages branches sees only those branches' 1st
  // year - the later years stay with each branch's own HOD (canHodEditDepartmentYear).
  const depts = (deptSnap?.docs ?? []).map((d) => ({ id: d.id, ...d.data() })) as unknown as DepartmentYearRow[];
  const catalogOf = new Map((courseSnap?.docs ?? []).map((d) => [d.id, String(d.get("catalogId") ?? "") || undefined]));
  const canSeeSection = (department: string, year: number, courseId: string) =>
    !scope || canHodEditDepartmentYear(scope, depts, department, year, catalogOf.get(courseId));
  const sections: ScopedSection[] = snap.docs
    .map((d) => ({ ...(d.data() as Section), id: d.id }))
    .filter((s) => s.department && canSee(s.department) && canSeeSection(s.department, Number(s.year), s.courseId))
    .map((s) => ({ id: s.id, name: s.name, label: `${yearRoman(Number(s.year))}-${s.name}`, department: s.department, year: Number(s.year), courseId: s.courseId }))
    .sort((a, b) => a.department.localeCompare(b.department) || a.year - b.year || a.name.localeCompare(b.name));
  return { canSee, canSeeSection, facultyDepts, sections };
}

const chunk = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

// ── Today ───────────────────────────────────────────────────────────────────

// Today's figures are kept 60 seconds per viewer (the page refreshes every 5 minutes; several tabs share one read).
const todayCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof computeToday>> }>();
const cacheKey = (collegeId: string, who: DashScope) => `${collegeId}:${who.kind === "hod" ? who.uid : "college"}`;

export async function loadDashToday(db: Db, collegeId: string, who: DashScope) {
  const key = cacheKey(collegeId, who);
  const hit = todayCache.get(key);
  if (hit && Date.now() - hit.at < 60_000 && !process.env.FIRESTORE_EMULATOR_HOST) return hit.value;
  const value = await computeToday(db, collegeId, who);
  todayCache.set(key, { at: Date.now(), value });
  return value;
}
export const loadHodToday = (db: Db, collegeId: string, uid: string) => loadDashToday(db, collegeId, { kind: "hod", uid });

async function computeToday(db: Db, collegeId: string, who: DashScope) {
  const { dateISO: today, timeHHMM: now } = nowInIndia();
  const collegeRef = db.collection("colleges").doc(collegeId);
  const { facultyDepts, sections } = await scopedSections(db, collegeId, who);
  const sectionIds = new Set(sections.map((s) => s.id));
  const college = who.kind === "college";

  const [deptFacultySnap, assignmentSnaps, sessionsSnap, leaveSnap, deptSnap] = await Promise.all([
    college ? collegeRef.collection("facultyMembers").get()
      : facultyDepts!.length ? whereIn(collegeRef.collection("facultyMembers"), "department", facultyDepts!).get() : Promise.resolve(null),
    college ? Promise.resolve([] as FirebaseFirestore.QuerySnapshot[])
      : Promise.all(chunk([...sectionIds], 30).map((ids) => collegeRef.collection("teachingAssignments").where("sectionId", "in", ids).select("facultyId", "isPast").get())),
    collegeRef.collection("studentAttendance").where("date", "==", today).where("status", "==", "SUBMITTED").get(),
    REQUESTS_COL(collegeId, db).where("status", "==", "APPROVED").get(),
    college ? collegeRef.collection("departments").select("hodUid", "name", "code").get() : Promise.resolve(null),
  ]);
  const departmentCodes: Record<string, string> = Object.fromEntries((deptSnap?.docs ?? [])
    .filter((d) => d.get("name") && d.get("code")).map((d) => [String(d.get("name")), String(d.get("code"))]));
  const hodUids = new Set((deptSnap?.docs ?? []).map((d) => d.get("hodUid") as string | undefined).filter((x): x is string => !!x));

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
  const periodsByFaculty = new Map<string, { periodNumber: number; sectionId: string; start: string; end: string; subject: string }[]>();
  const timingCache = new Map();
  // 24 faculty at a time: each is a few small timetable reads, and the dashboard waits for all of them.
  for (const ids of chunk([...faculty.keys()], 24)) {
    const lists = await Promise.all(ids.map((id) => getFacultyPeriodsForDate(db, collegeId, id, today, timingCache).catch(() => [])));
    lists.forEach((list, i) => {
      const f = faculty.get(ids[i])!;
      for (const p of list) {
        const sectionId = p.slot.sectionId ?? "";
        const periodNumber = p.slot.periodNumber;
        periodsByFaculty.set(ids[i], [...(periodsByFaculty.get(ids[i]) ?? []), { periodNumber, sectionId, start: p.startTime ?? "", end: p.endTime ?? "", subject: p.slot.subjectName ?? "" }]);
        if (!sectionIds.has(sectionId)) continue;
        const key = `${sectionId}|${periodNumber}`;
        cells[key] = mergeCell(cells[key], {
          status: classStatus(postedKeys.has(key), p.startTime, p.endTime, now),
          covered: !!p.adjustedFrom || !!p.attendanceOnly,
          subject: p.slot.subjectName || "",
          faculty: facultyDisplayName(f),
          facultyId: f.id,
          facultyDepartment: f.department ?? "",
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
      const sec = sections.find((s) => s.id === sid);
      return { section: sec?.label ?? "", sectionDepartment: sec?.department ?? "", period: Number(p), subject: c.subject, faculty: c.faculty, facultyId: c.facultyId ?? "", facultyDepartment: c.facultyDepartment ?? "", end: c.end };
    })
    .sort((a, b) => a.period - b.period || a.section.localeCompare(b.section));

  // Students today, per section.
  const byId = new Map(sections.map((s) => [s.id, s]));
  const sectionRows = sectionAttendanceToday(asToday(sessions))
    .map((r) => ({ ...r, label: byId.get(r.sectionId)?.label ?? "", department: byId.get(r.sectionId)?.department ?? "" }))
    .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));
  // Who was marked today and present in no period (the "absent all day" count, by name) - for the card's detail.
  const absentees: { name: string; rollNumber: string; section: string; department: string; periods: number }[] = [];
  {
    const per = new Map<string, { name: string; rollNumber: string; sectionId: string; held: number; present: number }>();
    for (const s of sessions) {
      for (const e of s.entries ?? []) {
        if (isOnDutyMark(e.status)) continue;
        const k = `${s.sectionId}|${e.studentId}`;
        const cur = per.get(k) ?? { name: e.name, rollNumber: e.rollNumber, sectionId: s.sectionId ?? "", held: 0, present: 0 };
        cur.held += 1;
        if (e.status === "PRESENT") cur.present += 1;
        per.set(k, cur);
      }
    }
    for (const v of per.values()) {
      if (v.held > 0 && v.present === 0) {
        const sec = byId.get(v.sectionId);
        absentees.push({ name: v.name, rollNumber: v.rollNumber, section: sec?.label ?? "", department: sec?.department ?? "", periods: v.held });
      }
    }
    absentees.sort((a, b) => a.section.localeCompare(b.section) || a.rollNumber.localeCompare(b.rollNumber));
  }
  const counted = sectionRows.reduce((n, r) => n + r.counted, 0);
  const present = sectionRows.reduce((n, r) => n + r.present, 0);

  // Per department (the Principal's board): classes and students today.
  const deptRows = new Map<string, { department: string; total: number; due: number; posted: number; overdue: number; counted: number; present: number; absentAllDay: number }>();
  const deptRow = (department: string) => {
    const cur = deptRows.get(department) ?? { department, total: 0, due: 0, posted: 0, overdue: 0, counted: 0, present: 0, absentAllDay: 0 };
    deptRows.set(department, cur);
    return cur;
  };
  for (const [k, c] of Object.entries(cells)) {
    const dep = byId.get(k.split("|")[0])?.department;
    if (!dep) continue;
    const r = deptRow(dep);
    r.total += 1;
    if (c.status !== "UPCOMING") r.due += 1;
    if (c.status === "POSTED") r.posted += 1;
    if (c.status === "OVERDUE") r.overdue += 1;
  }
  for (const s of sectionRows) {
    if (!s.department) continue;
    const r = deptRow(s.department);
    r.counted += s.counted; r.present += s.present; r.absentAllDay += s.absentAllDay;
  }

  // On leave today, and who covers their periods.
  const facultyByUid = new Map([...faculty.values()].filter((f) => f.userUid).map((f) => [f.userUid!, f]));
  const onLeave = leaveSnap.docs
    .map((d) => ({ ...(d.data() as LeaveRequest), id: d.id }))
    // The automatic 0.5 CL deduction for 3 late check-ins is stored as an approved CL dated that day - it is a
    // balance entry, not a day away (the person is at work), so it never shows as "on leave".
    .filter((r) => !r.isLateAttendancePenalty)
    .filter((r) => college || (!!r.department && facultyDepts!.includes(r.department)))
    .filter((r) => {
      const from = toDate(r.fromDate), to = toDate(r.toDate);
      return !!from && !!to && istDateKey(from) <= today && istDateKey(to) >= today;
    })
    .map((r) => {
      const subs = (r.periodSubstitutions ?? []).filter((p) => p.date === today);
      const f = facultyByUid.get(r.uid);
      // A half-day leave covers only its half (forenoon before 13:00, afternoon from 13:00 - the rule the class
      // adjustments and invigilation use), so the other half's periods are not "uncovered".
      // Today's part of the leave (a half day, or a range's half-day end): only those periods need cover.
      const todayPart = leavePartOn(r, today);
      const half = todayPart === "FN" || todayPart === "AN" ? todayPart : null;
      const mine = (f ? (periodsByFaculty.get(f.id) ?? []) : [])
        .filter((p) => partCovers(todayPart, p.start));
      const coveredPeriods = new Set(subs.map((p) => p.periodNumber));
      const open = mine.filter((p) => !coveredPeriods.has(p.periodNumber)).sort((a, b) => a.periodNumber - b.periodNumber);
      return {
        name: r.employeeName,
        department: r.department ?? "",
        isHod: hodUids.has(r.uid),
        handoverTo: r.handoverToName ?? null,
        leaveType: r.leaveTypeCode ?? "OTHER",
        halfDay: half,
        covers: subs.map((p) => ({ period: p.periodNumber, section: p.sectionName ?? "", substitute: p.substituteFacultyName })),
        uncovered: open.length,
        // Which periods: nobody is assigned to take them.
        uncoveredPeriods: open.map((p) => ({ period: p.periodNumber, section: byId.get(p.sectionId)?.label ?? "", subject: p.subject, start: p.start, end: p.end })),
      };
    })
    .sort((a, b) => Number(b.isHod) - Number(a.isHod) || b.uncovered - a.uncovered || a.name.localeCompare(b.name));

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
      absentees: absentees.slice(0, MAX_DETAIL_ROWS),
    },
    onLeave,
    departments: [...new Set(sections.map((s) => s.department))],
    departmentCodes,
    byDepartment: [...deptRows.values()].map((r) => ({ ...r, pct: r.counted ? Math.round((r.present / r.counted) * 1000) / 10 : null })),
  };
}

// ── This semester (cached 10 minutes per HOD) ───────────────────────────────

const semesterCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof computeSemester>> }>();
const TEN_MINUTES = 10 * 60_000;

export async function loadDashSemester(db: Db, collegeId: string, who: DashScope, fresh = false) {
  const key = cacheKey(collegeId, who);
  const hit = semesterCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TEN_MINUTES && !process.env.FIRESTORE_EMULATOR_HOST) return hit.value;
  const value = await computeSemester(db, collegeId, who);
  semesterCache.set(key, { at: Date.now(), value });
  return value;
}
export const loadHodSemester = (db: Db, collegeId: string, uid: string, fresh = false) => loadDashSemester(db, collegeId, { kind: "hod", uid }, fresh);

async function computeSemester(db: Db, collegeId: string, who: DashScope) {
  const today = nowInIndia().dateISO;
  const collegeRef = db.collection("colleges").doc(collegeId);
  const { canSee, canSeeSection, sections } = await scopedSections(db, collegeId, who);
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
  // Every student below the line, with the subjects they are short in - the "Below 75%" card's detail.
  const belowList: { name: string; rollNumber: string; section: string; department: string; pct: number; held: number; attended: number; shortIn: string[] }[] = [];
  const subjectShort = new Map<string, { label: string; name: string; below: number }>();
  let semesterStart: string | null = null;
  const shortByDept = new Map<string, { students: number; below: number }>();

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
        const shortIn: string[] = [];
        for (const [sid, t] of tallies) {
          held += t.held; attended += t.attended;
          const p = calcPercent(t.attended, t.held);
          if (p != null && p < SHORT) {
            const n = names.get(sid);
            shortIn.push(n?.code || n?.name || "");
            const cur = subjectShort.get(sid) ?? { label: n?.code ?? "", name: n?.name ?? "", below: 0 };
            cur.below += 1;
            subjectShort.set(sid, cur);
          }
        }
        const pct = calcPercent(attended, held);
        if (pct == null) continue;
        students += 1;
        if (pct < SHORT) {
          below += 1;
          belowList.push({ name: stu.name, rollNumber: stu.rollNumber, section: sec.label, department: sec.department, pct, held, attended, shortIn: shortIn.filter(Boolean) });
        }
        const dep = shortByDept.get(sec.department) ?? { students: 0, below: 0 };
        dep.students += 1;
        if (pct < SHORT) dep.below += 1;
        shortByDept.set(sec.department, dep);
        if (pct < CRITICAL) {
          critical += 1;
          criticalList.push({ name: stu.name, rollNumber: stu.rollNumber, section: sec.label, pct });
        }
      }
    }));
  }

  // Latest published Regular results per year of study.
  const batchesSnap = await collegeRef.collection("semesterResultBatches").where("status", "==", "PUBLISHED").where("examType", "==", "REGULAR").get();
  const batches = batchesSnap.docs.map((d) => ({ ...(d.data() as ExamResultBatch), id: d.id })).filter((b) => b.department && canSee(b.department) && canSeeSection(b.department, Number(b.year), b.courseIds?.[0] ?? ""));
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
      belowList: belowList.sort((a, b) => a.pct - b.pct).slice(0, MAX_DETAIL_ROWS),
      bySubject: [...subjectShort.values()].filter((x) => x.below > 0).sort((a, b) => b.below - a.below).slice(0, 6),
      byDepartment: [...shortByDept.entries()].map(([department, v]) => ({ department, ...v, pct: v.students ? Math.round((v.below / v.students) * 1000) / 10 : null })),
    },
    results: results.filter((r) => r.students > 0),
    computedAt: new Date().toISOString(),
  };
}
