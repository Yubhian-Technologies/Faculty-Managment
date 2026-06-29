import type { Firestore } from "firebase-admin/firestore";
import type {
  LeaveBalanceV2,
  LeaveTypeFull,
  EmployeeLeaveProfile,
  LeaveTypeCodeV2,
} from "@/types/leave";
import { LEAVE_TYPE_SEED } from "./seedData";
import { yearsOfService } from "./dayCounter";

export const LEAVE_COL = (collegeId: string, db: Firestore) =>
  db.collection("colleges").doc(collegeId).collection("leaveBalancesV2");

export const REQUESTS_COL = (collegeId: string, db: Firestore) =>
  db.collection("colleges").doc(collegeId).collection("leaveRequests");

export const PROFILES_COL = (collegeId: string, db: Firestore) =>
  db.collection("colleges").doc(collegeId).collection("employeeLeaveProfiles");

export function balanceDocId(uid: string, code: LeaveTypeCodeV2, year: number) {
  return `${uid}_${code}_${year}`;
}

// ─── Calculate annual entitlement ────────────────────────────────────────────

export function computeEntitlement(
  leaveType: LeaveTypeFull,
  profile: EmployeeLeaveProfile,
  year: number
): number {
  const rules = leaveType.rules;

  // Vacation entitlement handled separately from leave applications
  if (rules.isVacationEntitlement) return rules.daysPerYear ?? 0;

  // Leave-without-pay / special types have no fixed entitlement
  if (rules.isLeaveWithoutPay || rules.isLeaveNotDue) return 0;

  // Gender-based allocation (FPL)
  if (rules.genderDayAllocation) {
    return rules.genderDayAllocation[profile.gender] ?? 0;
  }

  // Per-completed-year accrual (ML: 20 days × completed years, max 60)
  if (rules.accrualBasis === "per_completed_year") {
    const doj = profile.dateOfJoining.toDate?.() ?? new Date(profile.dateOfJoining as unknown as string);
    const yearStart = new Date(year, 0, 1);
    const yrs = yearsOfService(doj, yearStart);
    const dailyRate = 20; // ML specific: 20 days per completed year
    return Math.min(rules.carryForwardCap ?? 60, yrs * dailyRate);
  }

  if (rules.accrualBasis === "none") return 0;

  // Annual fixed — EL differs by staff category
  if (leaveType.code === "EL") {
    return profile.staffCategory === "vacation" ? 6 : (rules.daysPerYear ?? 30);
  }

  // Teaching-staff-only types return 0 for non-teaching
  if (rules.eligibility?.isTeachingStaffOnly && !profile.isTeachingStaff) return 0;

  return rules.daysPerYear ?? 0;
}

// ─── Initialize balances for a year ──────────────────────────────────────────
// Creates balance docs for all applicable leave types for a given employee.
// Idempotent: skips types that already have a doc for this year.

export async function initBalancesForYear(
  db: Firestore,
  collegeId: string,
  uid: string,
  profile: EmployeeLeaveProfile,
  year: number,
  leaveTypes?: LeaveTypeFull[]
): Promise<void> {
  const types = leaveTypes ?? LEAVE_TYPE_SEED;
  const col = LEAVE_COL(collegeId, db);
  const now = new Date();

  const writes: Promise<unknown>[] = [];

  for (const lt of types) {
    if (!lt.isActive) continue;
    if (lt.rules.isVacationEntitlement) continue;

    const docId = balanceDocId(uid, lt.code, year);
    const docRef = col.doc(docId);
    const snap = await docRef.get();
    if (snap.exists) continue;

    const entitlement = computeEntitlement(lt, profile, year);

    const balance: Omit<LeaveBalanceV2, "id"> = {
      collegeId,
      uid,
      leaveTypeCode: lt.code,
      year,
      opening: 0,
      credited: entitlement,
      used: 0,
      pending: 0,
      carriedForward: 0,
      updatedAt: now as unknown as import("@/types/leave").LeaveBalanceV2["updatedAt"],
    };

    writes.push(docRef.set(balance));
  }

  await Promise.all(writes);
}

// ─── Load all balances for a user × year ─────────────────────────────────────

export async function loadBalances(
  db: Firestore,
  collegeId: string,
  uid: string,
  year: number
): Promise<LeaveBalanceV2[]> {
  const snap = await LEAVE_COL(collegeId, db)
    .where("uid", "==", uid)
    .where("year", "==", year)
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeaveBalanceV2));
}

// ─── Debit / credit helpers ───────────────────────────────────────────────────

export async function reservePending(
  db: Firestore,
  collegeId: string,
  uid: string,
  leaveTypeCode: LeaveTypeCodeV2,
  year: number,
  days: number
): Promise<void> {
  const ref = LEAVE_COL(collegeId, db).doc(balanceDocId(uid, leaveTypeCode, year));
  await ref.update({
    pending: (await ref.get()).data()?.pending ?? 0 + days,
    updatedAt: new Date(),
  });
}

export async function commitApproval(
  db: Firestore,
  collegeId: string,
  uid: string,
  leaveTypeCode: LeaveTypeCodeV2,
  year: number,
  days: number
): Promise<void> {
  const ref = LEAVE_COL(collegeId, db).doc(balanceDocId(uid, leaveTypeCode, year));
  const data = (await ref.get()).data() ?? {};
  await ref.update({
    pending: Math.max(0, (data.pending ?? 0) - days),
    used: (data.used ?? 0) + days,
    updatedAt: new Date(),
  });
}

export async function releasePending(
  db: Firestore,
  collegeId: string,
  uid: string,
  leaveTypeCode: LeaveTypeCodeV2,
  year: number,
  days: number
): Promise<void> {
  const ref = LEAVE_COL(collegeId, db).doc(balanceDocId(uid, leaveTypeCode, year));
  const data = (await ref.get()).data() ?? {};
  await ref.update({
    pending: Math.max(0, (data.pending ?? 0) - days),
    updatedAt: new Date(),
  });
}
