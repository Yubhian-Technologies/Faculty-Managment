import type { Firestore } from "firebase-admin/firestore";
import type { UserRole } from "@/types/core";
import { istDateKey, istMidnightUTC } from "@/lib/attendance/istTime";

// Roles that can be targeted by a Working Day override (colleges/{id}/
// workingDays - see college-office/holidays/page.tsx's Working Days section)
// - the same set of roles that can self-mark attendance or apply for leave
// (see check-in/route.ts and leave/applications/route.ts's own role lists).
// Students/Class Leaders and the system/location-scoped roles never mark
// college attendance, so they're never valid targets here.
export const WORKING_DAY_ELIGIBLE_ROLES: UserRole[] = [
  "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "PANEL_MEMBER", "COLLEGE_OFFICE", "COLLEGE_STAFF",
  "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "LIBRARY", "EXAM_CELL", "WEBMASTER",
  "COLLEGE_ACCOUNTS", "ACCOUNTS", "FINANCE", "PURCHASE_DEPT",
];

function workingDaysRef(db: Firestore, collegeId: string) {
  return db.collection("colleges").doc(collegeId).collection("workingDays");
}

// Is `date` a declared Working Day override that names `role`? Used to let a
// specific role (e.g. only PRINCIPAL) check in on what would otherwise be a
// Sunday off - see attendanceWindow.ts's isSunday, which this overrides on a
// per-date, per-role basis rather than replacing (everyone NOT named still
// gets the day off as usual).
export async function isWorkingDayForRole(
  db: Firestore,
  collegeId: string,
  date: Date,
  role: UserRole
): Promise<boolean> {
  const start = istMidnightUTC(date);
  const endExclusive = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const snap = await workingDaysRef(db, collegeId)
    .where("date", ">=", start)
    .where("date", "<", endExclusive)
    .get();
  return snap.docs.some((d) => ((d.data() as { roles?: UserRole[] }).roles ?? []).includes(role));
}

// dateKey() -> day weight (1 for a full working day, 0.5 for a half day) for
// every Working Day override date in [from, to] (inclusive) that names
// `role` - feeds countWorkingDays (dayCounter.ts) so a leave request spanning
// one of these dates still draws down balance for it instead of getting the
// automatic Sunday exclusion, and only draws down half a day when the
// override itself is half-day (e.g. a forenoon-only inspection - taking
// leave instead only costs the half day actually required).
export async function getWorkingDayWeightsForRole(
  db: Firestore,
  collegeId: string,
  from: Date,
  to: Date,
  role: UserRole
): Promise<Map<string, number>> {
  const start = istMidnightUTC(from);
  const endExclusive = new Date(istMidnightUTC(to).getTime() + 24 * 60 * 60 * 1000);
  const snap = await workingDaysRef(db, collegeId)
    .where("date", ">=", start)
    .where("date", "<", endExclusive)
    .get();
  const weights = new Map<string, number>();
  for (const doc of snap.docs) {
    const data = doc.data() as { date: { toDate(): Date }; roles?: UserRole[]; isHalfDay?: boolean };
    if ((data.roles ?? []).includes(role)) weights.set(istDateKey(data.date.toDate()), data.isHalfDay ? 0.5 : 1);
  }
  return weights;
}
