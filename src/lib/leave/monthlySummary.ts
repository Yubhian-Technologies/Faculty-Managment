import type { Firestore } from "firebase-admin/firestore";
import type { EffectiveLeaveCategory, LeaveBalance, LeaveRequest, LeaveTypeCode } from "@/types/leave";
import { LEAVE_TYPE_SEED } from "./seedData";
import { REQUESTS_COL, computeEntitlement, loadBalances, initBalancesForYear } from "./balanceEngine";
import { computeEffectiveCategory } from "./categoryEngine";
import { getOrCreateProfile } from "./profile";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { countWorkingDays } from "./dayCounter";
import { getHolidayDateKeys } from "./holidaysCount";

export interface MonthlyTypeSummary {
  taken: number;   // approved days whose fromDate falls in this month
  opb?: number;    // opening balance at month start (undefined for OD - unlimited)
  clb?: number;    // closing balance at month end (undefined for OD)
}

// The per-period (month, or whole-year totals) numbers shared by both the
// monthly and yearly summaries below.
export interface PeriodLeaveSummary {
  types: Partial<Record<LeaveTypeCode, MonthlyTypeSummary>>;
  lopDays: number; // total Loss of Pay days across all types, attributed by fromDate
  // "Other" requests never get a leaveTypeCode (see types/leave.ts), so they're
  // never balance-tracked and never show up in `types` - just how many days
  // were taken this period, same taken-only shape as OD.
  otherDays: number;
}

export interface MonthlyLeaveSummary extends PeriodLeaveSummary {
  uid: string;
  category: EffectiveLeaveCategory | null;
  dateOfJoining: Date | null;
}

export interface YearlyMonthSummary extends PeriodLeaveSummary {
  month: number; // 1-12
}

export interface YearlyLeaveSummary {
  uid: string;
  category: EffectiveLeaveCategory | null;
  dateOfJoining: Date | null;
  months: YearlyMonthSummary[]; // January (1) through December (12)
  totals: PeriodLeaveSummary;   // taken summed across the year; opb = January's opb, clb = December's clb
}

function toDate(v: unknown): Date {
  const t = v as { toDate?: () => Date } | undefined;
  return typeof t?.toDate === "function" ? t.toDate() : new Date(v as string);
}

// How many of a request's days fall inside [windowStart, windowEndExclusive).
//
// A request is NOT attributed wholly to the month it starts in. That was the
// old rule, on the stated assumption that spanning requests are rare because
// CL/SL/SCL run a few days - but "Other" leave (maternity and the like) runs
// for months, so a single 94-day request landed as 94 in its start month and
// nothing in the three months it actually covered. A monthly register is read
// per month, for payroll among other things, so each month must show its own
// days.
//
// Counted with the same countWorkingDays the request's stored totalDays was
// produced by, over the clipped span, so the months add back up to that total
// instead of a proration that only approximately does.
function daysWithinWindow(
  r: LeaveRequest,
  windowStart: Date,
  windowEndExclusive: Date,
  holidayDates: Set<string>
): number {
  const from = toDate(r.fromDate);
  const to = toDate(r.toDate ?? r.fromDate);
  const start = from > windowStart ? from : windowStart;
  // countWorkingDays takes an inclusive end, the window an exclusive one.
  const windowEnd = new Date(windowEndExclusive.getFullYear(), windowEndExclusive.getMonth(), windowEndExclusive.getDate() - 1);
  const end = to < windowEnd ? to : windowEnd;
  if (start > end) return 0;
  // A half day is 0.5 wherever it falls, and never spans a boundary.
  if (r.isHalfDay) return 0.5;
  return countWorkingDays(start, end, holidayDates);
}

// The same share, expressed as a fraction of the request's own total - used to
// split a request's lopDays across the months it covers. lopDays is a portion
// of totalDays (the part that exceeded balance), not a separately dated thing,
// so it can only be apportioned rather than recounted.
function shareOfRequest(
  r: LeaveRequest,
  windowStart: Date,
  windowEndExclusive: Date,
  holidayDates: Set<string>
): number {
  if (!r.totalDays) return 0;
  return daysWithinWindow(r, windowStart, windowEndExclusive, holidayDates) / r.totalDays;
}

// Pure - the date-filtering/summing math for a single month, given
// already-fetched requests/balances. Shared by computeMonthlyLeaveSummary and
// computeYearlyLeaveSummary so a yearly view doesn't refetch the same
// Firestore data 12 times over.
function computeMonthSummary(
  allApproved: LeaveRequest[], // this uid's APPROVED requests, every type
  category: EffectiveLeaveCategory | null,
  balanceByType: Map<LeaveTypeCode, LeaveBalance>,
  holidayDates: Set<string>,
  year: number,
  month: number // 1-12
): PeriodLeaveSummary {
  const approved = allApproved.filter((r) => r.leaveTypeCode);

  const monthStart = new Date(year, month - 1, 1);
  const monthEndExclusive = new Date(year, month, 1);

  // Days falling strictly before this month, and up to its end - the running
  // totals OPB/CLB are built from. Windowed rather than keyed off fromDate, so
  // a request straddling the boundary contributes only its earlier part to
  // "before" instead of all-or-nothing.
  const EPOCH = new Date(1970, 0, 1);
  const daysBefore = (r: LeaveRequest) => daysWithinWindow(r, EPOCH, monthStart, holidayDates);
  const daysThrough = (r: LeaveRequest) => daysWithinWindow(r, EPOCH, monthEndExclusive, holidayDates);
  const daysInMonth = (r: LeaveRequest) => daysWithinWindow(r, monthStart, monthEndExclusive, holidayDates);

  // Only the within-balance portion of each request ever gets committed to
  // `used` (see splitLeaveDays in applications/[id]/route.ts) - lopDays never
  // touches the balance, so OPB/CLB must subtract it out too, or a request
  // with any LOP days makes the running total overcount what's actually been
  // drawn down, pushing CLB negative even though the real balance is fine.
  // The balance-drawing portion of however many of a request's days fall in
  // the window - lopDays never touches balance, so it's excluded pro rata.
  const committedShare = (r: LeaveRequest, daysInWindow: number) =>
    r.totalDays ? daysInWindow * ((r.totalDays - (r.lopDays ?? 0)) / r.totalDays) : 0;

  const types: PeriodLeaveSummary["types"] = {};
  for (const lt of LEAVE_TYPE_SEED) {
    if (!lt.isActive) continue;
    if (category && !lt.rules.eligibleCategories.includes(category)) continue;

    const forType = approved.filter((r) => r.leaveTypeCode === lt.code);
    const taken = forType.reduce((sum, r) => sum + daysInMonth(r), 0);

    if (lt.rules.unlimited) {
      // OD: no balance is ever tracked - just how many days were taken.
      types[lt.code] = { taken };
      continue;
    }

    const bal = balanceByType.get(lt.code);
    const entitled = bal?.entitled ?? (category ? computeEntitlement(lt, category) : 0);
    types[lt.code] = {
      taken,
      opb: Math.max(0, entitled - forType.reduce((sum, r) => sum + committedShare(r, daysBefore(r)), 0)),
      clb: Math.max(0, entitled - forType.reduce((sum, r) => sum + committedShare(r, daysThrough(r)), 0)),
    };
  }

  const standardLopDays = approved
    .reduce((s, r) => s + (r.lopDays ?? 0) * shareOfRequest(r, monthStart, monthEndExclusive, holidayDates), 0);

  const otherRequests = allApproved.filter((r) => r.isOtherRequest);
  const otherDays = otherRequests.reduce((s, r) => s + daysInMonth(r), 0);
  // An "Other" request the HOD tagged unpaid (isPaidLeave: false) when
  // forwarding it - see types/leave.ts - is Loss of Pay by definition, so
  // those days count toward LOP same as a standard type's balance overflow,
  // on top of still showing under the Others column above. A paid Other
  // request contributes nothing here.
  const otherLopDays = otherRequests
    .filter((r) => r.isPaidLeave === false)
    .reduce((s, r) => s + daysInMonth(r), 0);
  const lopDays = standardLopDays + otherLopDays;

  return { types, lopDays, otherDays };
}

// Fetched once and reused by both computeMonthlyLeaveSummary (one month) and
// computeYearlyLeaveSummary (all 12) - the profile/settings/balances/requests
// don't change per-month, only which slice of `allApproved` counts.
async function loadEmployeeLeaveData(db: Firestore, collegeId: string, uid: string, year: number) {
  const [profile, settings] = await Promise.all([
    getOrCreateProfile(db, collegeId, uid),
    loadCollegeSettings(db, collegeId),
  ]);

  // Ensures `year`'s balance docs actually exist (idempotent - a no-op once
  // created, same guard as GET /api/leave/balances) rather than assuming
  // someone already viewed their own balance that year first. Without this, a
  // report for a year nobody's touched yet falls back to a bare base
  // entitlement below (no `bal` found), silently dropping Earned Leave's
  // carried-forward total - see initBalancesForYear's own recursive backfill
  // for why a whole chain of skipped years doesn't lose it either.
  if (profile) {
    await initBalancesForYear(db, collegeId, uid, profile, settings.newJoiningYears, year);
  }

  const [balances, reqSnap] = await Promise.all([
    loadBalances(db, collegeId, uid, year),
    REQUESTS_COL(collegeId, db).where("uid", "==", uid).get(),
  ]);

  const category = profile ? computeEffectiveCategory(profile, settings.newJoiningYears) : null;
  const dateOfJoining = profile ? toDate(profile.dateOfJoining) : null;
  const balanceByType = new Map(balances.map((b) => [b.leaveTypeCode, b]));
  const allApproved = reqSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as LeaveRequest)
    .filter((r) => r.status === "APPROVED");

  // Holidays across the whole reporting year plus a year either side, so a
  // request that starts before January or runs past December is still counted
  // by the same working-day rule for the part that lands inside the year.
  // Fetched once here rather than per month - computeYearlyLeaveSummary calls
  // computeMonthSummary twelve times off this one load.
  const holidayDates = await getHolidayDateKeys(
    db, collegeId, new Date(year - 1, 0, 1), new Date(year + 1, 11, 31)
  );

  return { category, dateOfJoining, balanceByType, allApproved, holidayDates };
}

// For a single employee: this month's days taken per leave type, plus the
// opening/closing balance for that month (entitled minus everything approved
// before/through the month). Attributed to a request's fromDate - leave
// requests spanning a month boundary are rare (CL/SL/SCL are usually a few
// days) and get counted in their start month.
export async function computeMonthlyLeaveSummary(
  db: Firestore,
  collegeId: string,
  uid: string,
  year: number,
  month: number // 1-12
): Promise<MonthlyLeaveSummary> {
  const { category, dateOfJoining, balanceByType, allApproved, holidayDates } = await loadEmployeeLeaveData(db, collegeId, uid, year);
  const summary = computeMonthSummary(allApproved, category, balanceByType, holidayDates, year, month);
  return { uid, category, dateOfJoining, ...summary };
}

// For a single employee: every month of the given year (same shape as
// computeMonthlyLeaveSummary, one per month) plus a `totals` row - taken
// summed across the year, opb from January, clb from December.
export async function computeYearlyLeaveSummary(
  db: Firestore,
  collegeId: string,
  uid: string,
  year: number
): Promise<YearlyLeaveSummary> {
  const { category, dateOfJoining, balanceByType, allApproved, holidayDates } = await loadEmployeeLeaveData(db, collegeId, uid, year);

  const months: YearlyMonthSummary[] = [];
  for (let month = 1; month <= 12; month++) {
    months.push({ month, ...computeMonthSummary(allApproved, category, balanceByType, holidayDates, year, month) });
  }

  const totals: PeriodLeaveSummary = { types: {}, lopDays: 0, otherDays: 0 };
  for (const lt of LEAVE_TYPE_SEED) {
    if (!lt.isActive) continue;
    if (category && !lt.rules.eligibleCategories.includes(category)) continue;

    const taken = months.reduce((s, m) => s + (m.types[lt.code]?.taken ?? 0), 0);
    if (lt.rules.unlimited) {
      totals.types[lt.code] = { taken };
      continue;
    }
    totals.types[lt.code] = {
      taken,
      opb: months[0].types[lt.code]?.opb,
      clb: months[11].types[lt.code]?.clb,
    };
  }
  totals.lopDays = months.reduce((s, m) => s + m.lopDays, 0);
  totals.otherDays = months.reduce((s, m) => s + m.otherDays, 0);

  return { uid, category, dateOfJoining, months, totals };
}
