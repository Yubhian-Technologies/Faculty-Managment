import type { Firestore } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { badBodyResponse } from "@/lib/http/readJsonBody";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import { makeLiveSlotPredicate } from "@/lib/timetable/liveSlots";
import { loadTimingLookup } from "@/lib/timetable/facultyOverlap";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import { dayOfWeekFromISODate } from "@/lib/timetable/leisureQuery";
import { getActiveSubstitutionsForDates } from "@/lib/leave/periodCoverage";
import { REQUESTS_COL } from "@/lib/leave/balanceEngine";
import { istDateKey } from "@/lib/attendance/istTime";
import { facultyActiveOn, loadLabWindows } from "@/lib/students/labFacultyWindow";
import { isFacultyAvailable } from "@/types";
import type { CourseYearTiming, MidExamPlan, MidTimetable, PeriodTiming, TimetableDraft, TimetableSlot } from "@/types";
import type { ExamSeatingPlan } from "@/types/examSeating";
import type { DutyRef, DutySlot, FacultyDutyLock, InvigilationDuty, InvigilationRules, InvigilationSchedule } from "@/types/invigilation";
import { rulesOf } from "./rules";
import { buildSlots, type ExamOfGroup, type SeatedRoom } from "./slots";
import type { CandidateFacts, TimeRange } from "./eligibility";

// Invigilation, server side: the schedule's exams, rooms and duty slots; each
// faculty member's day (classes, leave), the subjects they teach, and the
// duties they hold. Read from the existing records - Mid timetables, paired
// Exam Seating plans, the teaching timetable, approved leave, teaching
// assignments - never copied.

export const INVIGILATION_ROLES = ["EXAM_CELL"] as const;
export const INVIGILATION_READ_ROLES = ["EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL"] as const;

export const college = (db: Firestore, c: string) => db.collection("colleges").doc(c);
export const schedulesCol = (db: Firestore, c: string) => college(db, c).collection("invigilationSchedules");
export const dutiesCol = (db: Firestore, c: string) => college(db, c).collection("invigilationDuties");
export const locksCol = (db: Firestore, c: string) => college(db, c).collection("invigilationFacultyLocks");
export const lockId = (scheduleId: string, facultyId: string) => `${scheduleId}__${facultyId}`;

export function invigilationError(err: unknown, tag: string) {
  const badBody = badBodyResponse(err);
  if (badBody) return badBody;
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.error(tag, err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

export async function loadSchedule(db: Firestore, c: string, id: string): Promise<(InvigilationSchedule & { rules: InvigilationRules }) | null> {
  const snap = await schedulesCol(db, c).doc(id).get();
  if (!snap.exists) return null;
  const s = { ...(snap.data() as InvigilationSchedule), id: snap.id };
  return { ...s, rules: rulesOf(s.rules), publishedSessions: s.publishedSessions ?? [] };
}

/** The Mid timetables' exams per group ("CSE (1st Year)", as the seating plans name groups). */
export async function scheduleExams(db: Firestore, c: string, midPlanIds: string[]): Promise<Map<string, ExamOfGroup[]>> {
  const out = new Map<string, ExamOfGroup[]>();
  if (!midPlanIds.length) return out;
  const ref = college(db, c);
  const [plans, tts] = await Promise.all([
    db.getAll(...midPlanIds.map((id) => ref.collection("midExamPlans").doc(id))),
    ref.collection("midTimetables").get(),
  ]);
  const planById = new Map(plans.filter((p) => p.exists).map((p) => [p.id, p.data() as MidExamPlan]));
  for (const d of tts.docs) {
    const t = d.data() as MidTimetable;
    const plan = planById.get(t.planId);
    if (!plan) continue;
    const sessions = plan.sessions?.length ? plan.sessions : t.sessions;
    const group = `${t.branch} (${ordinalYearLabel(t.year)})`;
    const exams = new Map<string, ExamOfGroup>();
    for (const sl of t.slots ?? []) {
      const ses = sessions.find((x) => x.id === sl.sessionId) ?? t.sessions.find((x) => x.id === sl.sessionId);
      if (!ses) continue;
      const k = `${sl.date}|${ses.from}`;
      const e = exams.get(k) ?? { date: sl.date, from: ses.from, to: ses.to, subjects: [], courseIds: t.courseIds ?? plan.courseIds, year: t.year, semester: plan.semester };
      if (!e.subjects.some((x) => x.id === sl.subjectId)) e.subjects.push({ id: sl.subjectId, code: sl.subjectCode, name: sl.subjectName });
      exams.set(k, e);
    }
    out.set(group, [...(out.get(group) ?? []), ...exams.values()]);
  }
  return out;
}

/** Rooms of the paired seating plans built from these Mid timetables, with students per group. */
export async function scheduleRooms(db: Firestore, c: string, midPlanIds: string[]): Promise<{ rooms: SeatedRoom[]; plans: { id: string; name: string; status: string }[] }> {
  const snap = await college(db, c).collection("examSeatingPlans").where("mode", "==", "PAIRED").get();
  const plans = snap.docs.map((d) => ({ ...(d.data() as ExamSeatingPlan), id: d.id })).filter((p) => (p.midPlanIds ?? []).some((id) => midPlanIds.includes(id)));
  const rooms: SeatedRoom[] = [];
  for (const p of plans) {
    for (const r of p.rooms) {
      if (!r.students.length) continue;
      const groups: Record<string, number> = {};
      for (const s of r.students) if (s.group) groups[s.group] = (groups[s.group] ?? 0) + 1;
      rooms.push({ roomId: r.roomId, name: r.name, block: r.block, floor: r.floor, groups });
    }
  }
  return { rooms, plans: plans.map((p) => ({ id: p.id, name: p.name, status: p.status })) };
}

export async function scheduleSlots(db: Firestore, c: string, s: Pick<InvigilationSchedule, "midPlanIds"> & { rules: InvigilationRules }) {
  const [exams, seated] = await Promise.all([scheduleExams(db, c, s.midPlanIds), scheduleRooms(db, c, s.midPlanIds)]);
  return { slots: buildSlots(exams, seated.rooms, s.rules), seatingPlans: seated.plans, exams };
}

export interface PoolFaculty {
  id: string;
  employeeId: string;
  name: string;
  department: string;
  designation: string;
  userUid?: string;
  roles: string[];
}

/** Faculty who can be on duty (working, incl. the manual On Leave flag - real leave is checked by date), with their seats. */
export async function facultyPool(db: Firestore, c: string): Promise<PoolFaculty[]> {
  const ref = college(db, c);
  const [fac, seats] = await Promise.all([ref.collection("facultyMembers").get(), ref.collection("roleSeats").where("isActive", "==", true).get()]);
  const seatsByUid = new Map<string, string[]>();
  for (const d of seats.docs) {
    const s = d.data() as { holderUid?: string | null; label?: string };
    if (s.holderUid && s.label) seatsByUid.set(s.holderUid, [...(seatsByUid.get(s.holderUid) ?? []), s.label]);
  }
  return fac.docs
    .map((d) => ({ id: d.id, ...(d.data() as { status?: string; employeeId?: string; department?: string; designation?: string; userUid?: string; legalName?: string }) }))
    .filter((f) => isFacultyAvailable(f.status) || f.status === "ON_LEAVE")
    .map((f) => ({
      id: f.id, employeeId: f.employeeId ?? "", name: facultyDisplayName(f), department: f.department ?? "", designation: f.designation ?? "",
      ...(f.userUid ? { userUid: f.userUid } : {}), roles: f.userUid ? seatsByUid.get(f.userUid) ?? [] : [],
    }))
    .sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
}

const normalizePeriods = (arr: PeriodTiming[]): PeriodTiming[] =>
  arr.map((p) => ({ ...p, period: p.period ?? (p as { periodNumber?: number }).periodNumber ?? 0 }));

/**
 * Every faculty member's classes on `date` (clock ranges), the same way Free
 * Faculty reads them: published + draft periods of the live semester and
 * academic year, substitutions covering a colleague, lab-only dates, "not
 * teaching load" subjects left out. Classes of `suspended` course-years (the
 * ones writing that day) are left out when the rule says so. `withTimetable`
 * = faculty with any live period at all.
 */
export async function dayClasses(db: Firestore, c: string, date: string, suspended: { courseIds: string[]; year: number }[]) {
  const ref = college(db, c);
  const day = dayOfWeekFromISODate(date);
  const [timingsSnap, slotsSnap, draftsSnap, offSnap] = await Promise.all([
    ref.collection("courseYearTimings").get(),
    ref.collection("timetableSlots").get(),
    ref.collection("timetableDrafts").get(),
    ref.collection("subjects").where("isNonTeachingLoad", "==", true).get(),
  ]);
  const off = new Set(offSnap.docs.map((d) => d.id));
  const timings = timingsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as CourseYearTiming);
  const slots = slotsSnap.docs.map((d) => ({ ...(d.data() as TimetableSlot), id: d.id }));
  const drafts = draftsSnap.docs.map((d) => d.data() as TimetableDraft).filter((x) => x.status === "DRAFT");
  const needed = [...slots, ...drafts].filter((x) => x.courseId && x.year != null).map((x) => ({ courseId: x.courseId, year: Number(x.year) }));
  const { lookup } = await loadTimingLookup(db, c, needed, timings);
  const isLive = makeLiveSlotPredicate(lookup, await resolveCollegeAcademicYear(db, c));
  const periodRange = (courseId: string, year: number, n: number): [string, string] | null => {
    const t = lookup(courseId, year);
    if (!t) return null;
    const pt = normalizePeriods(t.periods?.length ? t.periods : defaultPeriodTimings(t)).find((x) => x.period === n);
    return pt ? [pt.startTime, pt.endTime] : null;
  };
  const isSuspended = (courseId: string, year: number) => suspended.some((s) => s.year === Number(year) && s.courseIds.includes(courseId));

  const withTimetable = new Set<string>();
  const classes = new Map<string, TimeRange[]>();
  const add = (facultyId: string, courseId: string, year: number, n: number, label: string) => {
    if (isSuspended(courseId, year)) return;
    const r = periodRange(courseId, year, n);
    if (r) classes.set(facultyId, [...(classes.get(facultyId) ?? []), { from: r[0], to: r[1], label }]);
  };
  const daySlots = slots.filter((s) => s.day === day);
  const labWindows = await loadLabWindows(db, c, [...daySlots, ...drafts.flatMap((d) => (d.slots ?? []).map((x) => ({ sectionId: (x as { sectionId?: string }).sectionId ?? d.sectionId, subjectId: x.subjectId })))]);

  for (const s of slots) {
    if (!s.facultyId || off.has(s.subjectId) || !isLive({ courseId: s.courseId, year: s.year, semester: s.semester, academicYear: s.academicYear })) continue;
    withTimetable.add(s.facultyId);
    if (s.day !== day || !facultyActiveOn(labWindows, s.sectionId, s.subjectId, s.facultyId, date)) continue;
    add(s.facultyId, s.courseId, s.year, s.periodNumber, s.subjectName);
  }
  const slotById = new Map(slots.map((s) => [s.id, s]));
  for (const sub of await getActiveSubstitutionsForDates(db, c, [date])) {
    const s = slotById.get(sub.timetableSlotId);
    if (s && sub.substituteFacultyId && !off.has(s.subjectId)) add(sub.substituteFacultyId, s.courseId, s.year, s.periodNumber, `covering ${s.subjectName}`);
  }
  for (const d of drafts) {
    if (!isLive({ courseId: d.courseId, year: d.year, semester: d.semester, academicYear: (d as { academicYear?: string }).academicYear })) continue;
    for (const x of d.slots ?? []) {
      if (!x.facultyId || off.has(x.subjectId)) continue;
      withTimetable.add(x.facultyId);
      if (x.day !== day || !facultyActiveOn(labWindows, (x as { sectionId?: string }).sectionId ?? d.sectionId, x.subjectId, x.facultyId, date)) continue;
      add(x.facultyId, d.courseId, d.year, x.periodNumber, (x as { subjectName?: string }).subjectName ?? "draft timetable");
    }
  }
  return { classes, withTimetable };
}

/** Approved leave on `date`, by login uid (half days block their half). */
export async function dayLeave(db: Firestore, c: string, date: string): Promise<Map<string, TimeRange[]>> {
  const snap = await REQUESTS_COL(c, db).where("status", "==", "APPROVED").get();
  const out = new Map<string, TimeRange[]>();
  for (const d of snap.docs) {
    const r = d.data() as { uid?: string; fromDate?: { toDate?: () => Date }; toDate?: { toDate?: () => Date }; isHalfDay?: boolean; halfDaySession?: "FN" | "AN"; leaveTypeCode?: string };
    const f = r.fromDate?.toDate?.(), t = r.toDate?.toDate?.();
    if (!r.uid || !f || !t || istDateKey(f) > date || istDateKey(t) < date) continue;
    const range: TimeRange = r.isHalfDay && r.halfDaySession
      ? (r.halfDaySession === "FN" ? { from: "00:00", to: "13:00", label: `${r.leaveTypeCode ?? "Leave"} - forenoon` } : { from: "13:00", to: "24:00", label: `${r.leaveTypeCode ?? "Leave"} - afternoon` })
      : { from: "00:00", to: "24:00", label: r.leaveTypeCode ?? "Leave" };
    out.set(r.uid, [...(out.get(r.uid) ?? []), range]);
  }
  return out;
}

/** Who teaches (now) / taught (isPast) each of these subjects - faculty ids. */
export async function subjectTeachers(db: Firestore, c: string, subjectIds: string[]) {
  const now = new Map<string, Set<string>>(), past = new Map<string, Set<string>>();
  const ids = [...new Set(subjectIds)];
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await college(db, c).collection("teachingAssignments").where("subjectId", "in", ids.slice(i, i + 30)).get();
    for (const d of snap.docs) {
      const a = d.data() as { facultyId?: string; subjectId: string; isPast?: boolean };
      if (!a.facultyId) continue;
      const m = a.isPast ? past : now;
      m.set(a.facultyId, (m.get(a.facultyId) ?? new Set()).add(a.subjectId));
    }
  }
  return { now, past };
}

/** Every faculty member's duties in a schedule (from their lock docs). */
export async function scheduleLocks(db: Firestore, c: string, scheduleId: string): Promise<Map<string, DutyRef[]>> {
  const snap = await locksCol(db, c).where("scheduleId", "==", scheduleId).get();
  return new Map(snap.docs.map((d) => { const l = d.data() as FacultyDutyLock; return [l.facultyId, l.duties ?? []]; }));
}

/** The facts the eligibility check needs for one person on one slot's day. */
export function factsFor(
  f: PoolFaculty,
  day: { classes: Map<string, TimeRange[]>; withTimetable: Set<string>; leave: Map<string, TimeRange[]> },
  teachers: { now: Map<string, Set<string>>; past: Map<string, Set<string>> },
  duties: DutyRef[],
): CandidateFacts {
  return {
    facultyId: f.id, designation: f.designation, department: f.department,
    classes: day.classes.get(f.id) ?? [],
    leave: f.userUid ? day.leave.get(f.userUid) ?? [] : [],
    hasTimetable: day.withTimetable.has(f.id),
    teachesNow: [...(teachers.now.get(f.id) ?? [])],
    taughtBefore: [...(teachers.past.get(f.id) ?? [])],
    duties,
  };
}

/** The course-years writing on a date (their classes are suspended that day when the rule says so). */
export function writingOn(slots: DutySlot[], date: string) {
  const out: { courseIds: string[]; year: number }[] = [];
  for (const s of slots) if (s.date === date) for (const cy of s.courseYears) if (!out.some((o) => o.year === cy.year && o.courseIds.join() === cy.courseIds.join())) out.push({ courseIds: cy.courseIds, year: cy.year });
  return out;
}

/** A duty's entry on its holder's lock doc. */
export const refOf = (d: Pick<InvigilationDuty, "id" | "slotKey" | "date" | "from" | "to" | "category" | "roomId" | "status">): DutyRef => ({
  dutyId: d.id, slotKey: d.slotKey, date: d.date, from: d.from, to: d.to, category: d.category, ...(d.roomId ? { roomId: d.roomId } : {}), status: d.status,
});

export async function actorName(db: Firestore, c: string, uid: string, fallback: string) {
  try {
    const me = await college(db, c).collection("users").doc(uid).get();
    return (me.data() as { name?: string } | undefined)?.name ?? fallback;
  } catch { return fallback; }
}
