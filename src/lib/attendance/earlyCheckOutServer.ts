import type { Firestore } from "firebase-admin/firestore";
import { istDateKey, istTimeHHMM } from "@/lib/attendance/istTime";
import { collegeEndTime } from "@/lib/attendance/attendanceTimingsServer";
import { approvedLeavePartOn } from "@/lib/leave/leaveStatusToday";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { getFacultyPeriodsForDate } from "@/lib/timetable/currentPeriod";
import { PENDING_PERMISSION_STATUSES, type PermissionRequestStatus } from "@/types/permission";
import type { ClassAdjustment } from "@/types/classAdjustment";
import {
  effectiveEndTime, isEarly, markCoverage, periodsLeft,
  type EarlyCheckOutState, type PermissionWindow, type RemainingPeriod,
} from "./earlyCheckOut";

// Roles that may have a timetable of their own (a faculty record with periods). Others only get the reason rule.
const TEACHING_ROLES = new Set(["PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL"]);
const LIVE_PERMISSION: PermissionRequestStatus[] = [...PENDING_PERMISSION_STATUSES, "APPROVED"];

/** Where today's check-out stands for this person: early or not, and (faculty) their classes still left. */
export async function earlyCheckOutState(
  db: Firestore, collegeId: string, uid: string, role: string, at: Date = new Date(),
): Promise<EarlyCheckOutState> {
  const today = istDateKey(at);
  const now = istTimeHHMM(at);
  const [endTime, leavePart] = await Promise.all([
    collegeEndTime(db, collegeId),
    approvedLeavePartOn(db, collegeId, uid, at),
  ]);
  const closingTime = effectiveEndTime(endTime, leavePart);
  const none: EarlyCheckOutState = { closingTime, early: false, periods: [], uncovered: [], permissionIds: [], pendingAdjustmentIds: [] };
  if (!isEarly(now, closingTime)) return none;
  if (!TEACHING_ROLES.has(role)) return { ...none, early: true };

  const facultyId = await resolveFacultyMemberId(db, collegeId, uid);
  const college = db.collection("colleges").doc(collegeId);
  const left = periodsLeft(await getFacultyPeriodsForDate(db, collegeId, facultyId, today), now);
  if (left.length === 0) return { ...none, early: true };

  const [permSnap, adjSnap, sectionSnaps] = await Promise.all([
    college.collection("permissionRequests").where("uid", "==", uid).get(),
    college.collection("classAdjustments").where("facultyIds", "array-contains", facultyId).get(),
    db.getAll(...[...new Set(left.map((p) => p.slot.sectionId).filter(Boolean))].map((id) => college.collection("sections").doc(id))),
  ]);

  const permissions: PermissionWindow[] = permSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as { date?: string; status?: PermissionRequestStatus; fromTime?: string; toTime?: string }) }))
    .filter((p) => p.date === today && !!p.status && LIVE_PERMISSION.includes(p.status) && p.fromTime && p.toTime)
    .map((p) => ({ id: p.id, fromTime: p.fromTime!, toTime: p.toTime! }));

  const pendingAdjustedSlotIds = new Set<string>();
  const pendingAdjustmentIds: string[] = [];
  for (const d of adjSnap.docs) {
    const a = d.data() as ClassAdjustment;
    if (a.date !== today || a.status !== "PENDING" || a.requesterFacultyId !== facultyId) continue;
    let mine = false;
    for (const leg of a.legs ?? []) if (leg.fromFacultyId === facultyId) { pendingAdjustedSlotIds.add(leg.slotId); mine = true; }
    if (mine) pendingAdjustmentIds.push(d.id);
  }

  const sectionName = new Map(sectionSnaps.map((s) => [s.id, String((s.data() as { name?: string } | undefined)?.name ?? "")]));
  const rows: Omit<RemainingPeriod, "coveredBy">[] = left.map((p) => ({
    slotId: p.slot.id,
    periodNumber: p.slot.periodNumber,
    startTime: p.startTime,
    endTime: p.endTime,
    subjectName: p.slot.subjectName ?? "",
    sectionId: p.slot.sectionId,
    sectionName: sectionName.get(p.slot.sectionId) ?? "",
    department: p.slot.department ?? "",
  }));
  const { periods, permissionIds } = markCoverage(rows, { now, pendingAdjustedSlotIds, permissions, leavePart });
  return {
    closingTime, early: true, periods, uncovered: periods.filter((p) => !p.coveredBy),
    permissionIds, pendingAdjustmentIds: periods.some((p) => p.coveredBy === "ADJUSTMENT") ? pendingAdjustmentIds : [],
  };
}
