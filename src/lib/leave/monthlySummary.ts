import type { Firestore } from "firebase-admin/firestore";
import type { EffectiveLeaveCategory, LeaveRequest, LeaveTypeCode } from "@/types/leave";
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

export interface MonthlyLeaveSummary {
  uid: string;
  category: EffectiveLeaveCategory | null;
  types: Partial<Record<LeaveTypeCode, MonthlyTypeSummary>>;
  lopDays: number; // total Loss of Pay days across all types, attributed by fromDate
}

function toDate(v: unknown): Date {
  const t = v as { toDate?: () => Date } | undefined;
  return typeof t?.toDate === "function" ? t.toDate() : new Date(v as string);
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
  const [profile, settings, balances, reqSnap] = await Promise.all([
    getOrCreateProfile(db, collegeId, uid),
    loadCollegeSettings(db, collegeId),
    loadBalances(db, collegeId, uid, year),
    REQUESTS_COL(collegeId, db).where("uid", "==", uid).get(),
  ]);

  const category = profile ? computeEffectiveCategory(profile, settings.newJoiningYears) : null;
  const balanceByType = new Map(balances.map((b) => [b.leaveTypeCode, b]));

  const monthStart = new Date(year, month - 1, 1);
  const monthEndExclusive = new Date(year, month, 1);

  const approved = reqSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as LeaveRequest)
    .filter((r) => r.status === "APPROVED" && r.leaveTypeCode);

  const sumTotalDays = (reqs: LeaveRequest[]) => reqs.reduce((s, r) => s + r.totalDays, 0);
  // Only the within-balance portion of each request ever gets committed to
  // `used` (see splitLeaveDays in applications/[id]/route.ts) - lopDays never
  // touches the balance, so OPB/CLB must subtract it out too, or a request
  // with any LOP days makes the running total overcount what's actually been
  // drawn down, pushing CLB negative even though the real balance is fine.
  const sumCommittedDays = (reqs: LeaveRequest[]) => reqs.reduce((s, r) => s + (r.totalDays - (r.lopDays ?? 0)), 0);

  const types: MonthlyLeaveSummary["types"] = {};
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

  return { uid, category, types, lopDays };
}
