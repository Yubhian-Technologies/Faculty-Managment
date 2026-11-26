import type { Firestore } from "firebase-admin/firestore";
import { istDateKey, istTimeHHMM } from "@/lib/attendance/istTime";
import { getFacultyPeriodsForDate, type FacultyPeriodOnDate, type TimingCache } from "@/lib/timetable/currentPeriod";
import { approvedLeavePartOn } from "@/lib/leave/leaveStatusToday";
import { partCovers } from "@/lib/leave/leaveDayParts";
import { findBranchManager, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import { getDepartmentHeadUids, notify, notifyRole } from "@/lib/notify";
import { cachedValue } from "@/lib/firestore/sharedReads";
import { dmy } from "@/lib/utils";
import { PENDING_PERMISSION_STATUSES, type PermissionRequestStatus } from "@/types/permission";
import type { StudentAttendanceSession } from "@/types";
import { attendancePostingRef } from "@/lib/attendance/attendancePosting";
import { cleanLateMarkDays, DEFAULT_LATE_MARK_DAYS, lateMarkBlock, lateMarkDates, permissionCoversPeriod } from "./lateMark";

const LIVE_PERMISSION: PermissionRequestStatus[] = [...PENDING_PERMISSION_STATUSES, "APPROVED"];
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/** The college's Late Marking days (0 = off), 60 s cached; unreadable = the default. */
export function lateMarkDays(db: Firestore, collegeId: string): Promise<number> {
  return cachedValue(`lateMarkDays/${collegeId}`, process.env.FIRESTORE_EMULATOR_HOST ? 0 : 60_000, async () => {
    try {
      const v = (await attendancePostingRef(db, collegeId).get()).data() as { lateMarkDays?: unknown } | undefined;
      return v?.lateMarkDays === undefined ? DEFAULT_LATE_MARK_DAYS : cleanLateMarkDays(v.lateMarkDays) ?? DEFAULT_LATE_MARK_DAYS;
    } catch {
      return DEFAULT_LATE_MARK_DAYS;
    }
  });
}

/** Midday IST of a date - for the helpers that take a Date and read its IST day. */
const middayOf = (dateISO: string) => new Date(`${dateISO}T12:00:00+05:30`);

interface DayContext {
  leavePart: Awaited<ReturnType<typeof approvedLeavePartOn>>;
  permissions: { fromTime: string; toTime: string }[];
  checkedIn: boolean;
}

async function dayContext(db: Firestore, collegeId: string, uid: string, dateISO: string, permissionDocs?: FirebaseFirestore.QueryDocumentSnapshot[]): Promise<DayContext> {
  const college = db.collection("colleges").doc(collegeId);
  const [leavePart, perms, record] = await Promise.all([
    approvedLeavePartOn(db, collegeId, uid, middayOf(dateISO)),
    permissionDocs ? Promise.resolve(permissionDocs) : college.collection("permissionRequests").where("uid", "==", uid).get().then((s) => s.docs),
    college.collection("attendanceRecords").doc(`${uid}_${dateISO}`).get(),
  ]);
  const permissions = perms
    .map((d) => d.data() as { date?: string; status?: PermissionRequestStatus; fromTime?: string; toTime?: string })
    .filter((p) => p.date === dateISO && !!p.status && LIVE_PERMISSION.includes(p.status) && !!p.fromTime && !!p.toTime)
    .map((p) => ({ fromTime: p.fromTime!, toTime: p.toTime! }));
  return { leavePart, permissions, checkedIn: !!(record.data() as { checkIn?: string } | undefined)?.checkIn };
}

function blockFor(p: FacultyPeriodOnDate, dateISO: string, today: string, nowMinutes: number, days: number, ctx: DayContext): string | null {
  return lateMarkBlock({
    date: dateISO, today, nowMinutes, days, closeTime: p.closeTime,
    onLeave: partCovers(ctx.leavePart, p.startTime),
    permissionCovers: ctx.permissions.some((w) => permissionCoversPeriod(w, p)),
  });
}

export type LateCheck =
  | { ok: true; slot: FacultyPeriodOnDate["slot"]; startTime: string; endTime: string; notCheckedIn: boolean }
  | { ok: false; message: string };

/**
 * The write gate for Late Marking: this faculty member had this exact period (assignment + period number) on
 * `dateISO` - by the timetable of that day, with its class adjustments and leave substitutes - its posting window
 * has closed, it is within the college's Late Marking days, and they weren't away for it (approved leave, or a
 * permission covering the whole class).
 */
export async function checkLatePeriod(
  db: Firestore, collegeId: string,
  who: { uid: string; facultyMemberId: string },
  assignmentId: string, dateISO: string, periodNumber: number | undefined, now: Date = new Date(),
): Promise<LateCheck> {
  if (periodNumber == null) return { ok: false, message: "Pick the period to mark late." };
  const today = istDateKey(now);
  const days = await lateMarkDays(db, collegeId);
  const periods = await getFacultyPeriodsForDate(db, collegeId, who.facultyMemberId, dateISO, new Map(), { semesterOnDate: dateISO !== today });
  const p = periods.find((x) => x.slot.assignmentId === assignmentId && x.slot.periodNumber === periodNumber && !x.unavailableReason);
  if (!p) return { ok: false, message: "This class was not on your timetable that day." };
  const ctx = await dayContext(db, collegeId, who.uid, dateISO);
  const block = blockFor(p, dateISO, today, toMin(istTimeHHMM(now)), days, ctx);
  if (block) return { ok: false, message: block };
  return { ok: true, slot: p.slot, startTime: p.startTime, endTime: p.endTime, notCheckedIn: !ctx.checkedIn };
}

export interface MissedPeriod {
  date: string;
  assignmentId: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  subjectName: string;
  sectionId: string;
  department: string;
  year: number;
  /** A draft was opened and left (marks kept). */
  draft: boolean;
  /** Why it can't be marked late (shown greyed). */
  blocked?: string;
}

/** The faculty member's periods of the Late Marking days whose posting closed and were never submitted. */
export async function missedPeriods(
  db: Firestore, collegeId: string, who: { uid: string; facultyMemberId: string }, now: Date = new Date(),
): Promise<{ days: number; periods: MissedPeriod[] }> {
  const days = await lateMarkDays(db, collegeId);
  if (days <= 0) return { days, periods: [] };
  const today = istDateKey(now);
  const nowMinutes = toMin(istTimeHHMM(now));
  const college = db.collection("colleges").doc(collegeId);
  const cache: TimingCache = new Map();
  const permDocs = (await college.collection("permissionRequests").where("uid", "==", who.uid).get()).docs;
  const out: MissedPeriod[] = [];
  for (const date of lateMarkDates(today, days)) {
    const periods = (await getFacultyPeriodsForDate(db, collegeId, who.facultyMemberId, date, cache, { semesterOnDate: date !== today }))
      .filter((p) => !p.unavailableReason && (date !== today || nowMinutes >= toMin(p.closeTime)));
    if (periods.length === 0) continue;
    const [ctx, sessions] = await Promise.all([
      dayContext(db, collegeId, who.uid, date, permDocs),
      db.getAll(...periods.map((p) => college.collection("studentAttendance").doc(`${p.slot.assignmentId}_${date}_${p.slot.periodNumber}`))),
    ]);
    periods.forEach((p, i) => {
      const s = sessions[i].exists ? (sessions[i].data() as StudentAttendanceSession) : null;
      if (s?.status === "SUBMITTED") return;
      const blocked = blockFor(p, date, today, nowMinutes, days, ctx);
      out.push({
        date, assignmentId: p.slot.assignmentId, periodNumber: p.slot.periodNumber, startTime: p.startTime, endTime: p.endTime,
        subjectName: p.slot.subjectName ?? "", sectionId: p.slot.sectionId ?? "", department: p.slot.department ?? "", year: p.slot.year,
        draft: !!s, ...(blocked ? { blocked } : {}),
      });
    });
  }
  return { days, periods: out };
}

/** HODs who look after this class: the section's department, or - for a shared year another department manages
 *  (e.g. a branch's 1st year under Basic Science) - that managing department. */
export async function classHodUids(db: Firestore, collegeId: string, department: string, year: number | undefined): Promise<string[]> {
  if (!department) return [];
  try {
    const depts = (await db.collection("colleges").doc(collegeId).collection("departments").get()).docs
      .map((d) => ({ id: d.id, ...(d.data() as object) }) as unknown as DepartmentYearRow & { name: string });
    const manager = findBranchManager(depts, department);
    if (manager && year != null && manager.years.includes(year)) {
      return getDepartmentHeadUids(db, collegeId, manager.department.name);
    }
  } catch (err) {
    console.warn("[lateMark classHodUids]", err);
  }
  return getDepartmentHeadUids(db, collegeId, department);
}

/** After a late-marked class is submitted: the class's HOD is told (the Principal when that HOD marked it). */
export async function notifyLateMark(db: Firestore, collegeId: string, s: StudentAttendanceSession, markerUid: string): Promise<void> {
  try {
    const reason = s.lateMark?.reason ?? "";
    const message = `${s.facultyName || "A faculty member"} marked ${s.subjectName} (Period ${s.periodNumber}, ${s.sectionName}) for ${dmy(s.date)} late${s.lateMark?.notCheckedIn ? " - not checked in that day" : ""}. Reason: ${reason}`;
    const hods = (await classHodUids(db, collegeId, s.department, s.year)).filter((u) => u !== markerUid);
    if (hods.length === 0) {
      await notifyRole(db, collegeId, "PRINCIPAL", "STUDENT_ATTENDANCE_MARKED_LATE", "Class Attendance Marked Late", message, "/principal/attendance-completion");
      return;
    }
    for (const uid of hods) await notify(db, collegeId, uid, "STUDENT_ATTENDANCE_MARKED_LATE", "Class Attendance Marked Late", message, "/hod/attendance-completion");
  } catch (err) {
    console.error("[lateMark notify]", err);
  }
}
