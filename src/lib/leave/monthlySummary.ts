import type { Firestore } from "firebase-admin/firestore";
import type { EffectiveLeaveCategory, LeaveBalance, LeaveRequest, LeaveTypeCode } from "@/types/leave";
import { LEAVE_TYPE_SEED } from "./seedData";
import { REQUESTS_COL, computeEntitlement, loadBalances } from "./balanceEngine";
import { computeEffectiveCategory } from "./categoryEngine";
import { getOrCreateProfile } from "./profile";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";

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
}

export interface YearlyMonthSummary extends PeriodLeaveSummary {
  month: number; // 1-12
}

export interface YearlyLeaveSummary {
  uid: string;
  category: EffectiveLeaveCategory | null;
  months: YearlyMonthSummary[]; // January (1) through December (12)
  totals: PeriodLeaveSummary;   // taken summed across the year; opb = January's opb, clb = December's clb
}

function toDate(v: unknown): Date {
  const t = v as { toDate?: () => Date } | undefined;
  return typeof t?.toDate === "function" ? t.toDate() : new Date(v as string);
}

// Pure - the date-filtering/summing math for a single month, given
// already-fetched requests/balances. Shared by computeMonthlyLeaveSummary and
// computeYearlyLeaveSummary so a yearly view doesn't refetch the same
// Firestore data 12 times over.
function computeMonthSummary(
  allApproved: LeaveRequest[], // this uid's APPROVED requests, every type
  category: EffectiveLeaveCategory | null,
  balanceByType: Map<LeaveTypeCode, LeaveBalance>,
  year: number,
  month: number // 1-12
): PeriodLeaveSummary {
  const approved = allApproved.filter((r) => r.leaveTypeCode);

  const monthStart = new Date(year, month - 1, 1);
  const monthEndExclusive = new Date(year, month, 1);

  const sumTotalDays = (reqs: LeaveRequest[]) => reqs.reduce((s, r) => s + r.totalDays, 0);
  // Only the within-balance portion of each request ever gets committed to
  // `used` (see splitLeaveDays in applications/[id]/route.ts) - lopDays never
  // touches the balance, so OPB/CLB must subtract it out too, or a request
  // with any LOP days makes the running total overcount what's actually been
  // drawn down, pushing CLB negative even though the real balance is fine.
  const sumCommittedDays = (reqs: LeaveRequest[]) => reqs.reduce((s, r) => s + (r.totalDays - (r.lopDays ?? 0)), 0);

  const types: PeriodLeaveSummary["types"] = {};
  for (const lt of LEAVE_TYPE_SEED) {
    if (!lt.isActive) continue;
    if (category && !lt.rules.eligibleCategories.includes(category)) continue;

    const forType = approved.filter((r) => r.leaveTypeCode === lt.code);
    const beforeMonthReqs = forType.filter((r) => toDate(r.fromDate) < monthStart);
    const throughMonthReqs = forType.filter((r) => toDate(r.fromDate) < monthEndExclusive);
    const taken = sumTotalDays(throughMonthReqs) - sumTotalDays(beforeMonthReqs);

    if (lt.rules.unlimited) {
      // OD: no balance is ever tracked - just how many days were taken.
      types[lt.code] = { taken };
      continue;
    }

    const bal = balanceByType.get(lt.code);
    const entitled = bal?.entitled ?? (category ? computeEntitlement(lt, category) : 0);
    types[lt.code] = {
      taken,
      opb: Math.max(0, entitled - sumCommittedDays(beforeMonthReqs)),
      clb: Math.max(0, entitled - sumCommittedDays(throughMonthReqs)),
    };
  }

  const lopDays = approved
    .filter((r) => toDate(r.fromDate) >= monthStart && toDate(r.fromDate) < monthEndExclusive)
    .reduce((s, r) => s + (r.lopDays ?? 0), 0);

  const otherDays = allApproved
    .filter((r) => r.isOtherRequest)
    .filter((r) => toDate(r.fromDate) >= monthStart && toDate(r.fromDate) < monthEndExclusive)
    .reduce((s, r) => s + r.totalDays, 0);

  return { types, lopDays, otherDays };
}

// Fetched once and reused by both computeMonthlyLeaveSummary (one month) and
// computeYearlyLeaveSummary (all 12) - the profile/settings/balances/requests
// don't change per-month, only which slice of `allApproved` counts.
async function loadEmployeeLeaveData(db: Firestore, collegeId: string, uid: string, year: number) {
  const [profile, settings, balances, reqSnap] = await Promise.all([
    getOrCreateProfile(db, collegeId, uid),
    loadCollegeSettings(db, collegeId),
    loadBalances(db, collegeId, uid, year),
    REQUESTS_COL(collegeId, db).where("uid", "==", uid).get(),
  ]);

  const category = profile ? computeEffectiveCategory(profile, settings.newJoiningYears) : null;
  const balanceByType = new Map(balances.map((b) => [b.leaveTypeCode, b]));
  const allApproved = reqSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as LeaveRequest)
    .filter((r) => r.status === "APPROVED");

  return { category, balanceByType, allApproved };
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
  const { category, balanceByType, allApproved } = await loadEmployeeLeaveData(db, collegeId, uid, year);
  const summary = computeMonthSummary(allApproved, category, balanceByType, year, month);
  return { uid, category, ...summary };
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
  const { category, balanceByType, allApproved } = await loadEmployeeLeaveData(db, collegeId, uid, year);

  const months: YearlyMonthSummary[] = [];
  for (let month = 1; month <= 12; month++) {
    months.push({ month, ...computeMonthSummary(allApproved, category, balanceByType, year, month) });
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

  return { uid, category, months, totals };
}
