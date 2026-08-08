import type { Firestore } from "firebase-admin/firestore";
import type { LeaveBalance, LeaveTypeFull, EmployeeLeaveProfile, LeaveTypeCode, EffectiveLeaveCategory } from "@/types/leave";
import { LEAVE_TYPE_SEED } from "./seedData";
import { computeEffectiveCategory } from "./categoryEngine";

// EL is the one leave type whose annual entitlement depends on the profile's
// effective category (vacation/teaching staff: 6 days; non-vacation/
// supporting staff: 30 days) rather than a flat rules.daysPerYear.
export function computeEntitlement(leaveType: LeaveTypeFull, category: EffectiveLeaveCategory): number {
  if (leaveType.rules.unlimited) return 0;
  if (leaveType.code === "EL") return category === "vacation" ? 6 : 30;
  return leaveType.rules.daysPerYear ?? 0;
}

export const BALANCES_COL = (collegeId: string, db: Firestore) =>
  db.collection("colleges").doc(collegeId).collection("leaveBalances");

export const REQUESTS_COL = (collegeId: string, db: Firestore) =>
  db.collection("colleges").doc(collegeId).collection("leaveRequests");

export const PROFILES_COL = (collegeId: string, db: Firestore) =>
  db.collection("colleges").doc(collegeId).collection("employeeLeaveProfiles");

export function balanceDocId(uid: string, code: LeaveTypeCode, year: number) {
  return `${uid}_${code}_${year}`;
}

// ─── Initialize this year's balances for every leave type this profile is
// currently eligible for (based on effective category). Idempotent per type.

export async function initBalancesForYear(
  db: Firestore,
  collegeId: string,
  uid: string,
  profile: EmployeeLeaveProfile,
  newJoiningYears: number,
  year: number,
  leaveTypes?: LeaveTypeFull[]
): Promise<void> {
  const types = leaveTypes ?? LEAVE_TYPE_SEED;
  const effectiveCategory = computeEffectiveCategory(profile, newJoiningYears);
  const col = BALANCES_COL(collegeId, db);
  const now = new Date();

  const writes: Promise<unknown>[] = [];

  for (const lt of types) {
    if (!lt.isActive) continue;
    if (lt.rules.unlimited) continue; // OD - no balance tracked
    if (!lt.rules.eligibleCategories.includes(effectiveCategory)) continue;

    const docId = balanceDocId(uid, lt.code, year);
    const docRef = col.doc(docId);
    const snap = await docRef.get();
    if (snap.exists) continue;

    const balance: Omit<LeaveBalance, "id"> = {
      collegeId,
      uid,
      leaveTypeCode: lt.code,
      year,
      entitled: computeEntitlement(lt, effectiveCategory),
      used: 0,
      pending: 0,
      updatedAt: now as unknown as LeaveBalance["updatedAt"],
    };

    writes.push(docRef.set(balance));
  }

  await Promise.all(writes);
}

export async function loadBalances(
  db: Firestore,
  collegeId: string,
  uid: string,
  year: number
): Promise<LeaveBalance[]> {
  const snap = await BALANCES_COL(collegeId, db)
    .where("uid", "==", uid)
    .where("year", "==", year)
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as LeaveBalance));
}

// reservePending/commitApproval/releasePending use set(..., {merge: true})
// rather than update() - the balance doc isn't guaranteed to exist yet (e.g.
// initBalancesForYear hasn't run for this employee/type/year), and update()
// throws NOT_FOUND on a missing doc. set-merge upserts identity fields plus
// the new pending/used value either way; readers already fall back to a
// computed default when `entitled` is absent from a doc created this way.

export async function reservePending(
  db: Firestore,
  collegeId: string,
  uid: string,
  leaveTypeCode: LeaveTypeCode,
  year: number,
  days: number
): Promise<void> {
  const ref = BALANCES_COL(collegeId, db).doc(balanceDocId(uid, leaveTypeCode, year));
  const data = (await ref.get()).data() ?? {};
  await ref.set(
    { collegeId, uid, leaveTypeCode, year, pending: (data.pending ?? 0) + days, updatedAt: new Date() },
    { merge: true }
  );
}

export async function commitApproval(
  db: Firestore,
  collegeId: string,
  uid: string,
  leaveTypeCode: LeaveTypeCode,
  year: number,
  days: number
): Promise<void> {
  const ref = BALANCES_COL(collegeId, db).doc(balanceDocId(uid, leaveTypeCode, year));
  const data = (await ref.get()).data() ?? {};
  await ref.set(
    {
      collegeId, uid, leaveTypeCode, year,
      pending: Math.max(0, (data.pending ?? 0) - days),
      used: (data.used ?? 0) + days,
      updatedAt: new Date(),
    },
    { merge: true }
  );
}

export async function releasePending(
  db: Firestore,
  collegeId: string,
  uid: string,
  leaveTypeCode: LeaveTypeCode,
  year: number,
  days: number
): Promise<void> {
  const ref = BALANCES_COL(collegeId, db).doc(balanceDocId(uid, leaveTypeCode, year));
  const data = (await ref.get()).data() ?? {};
  await ref.set(
    { collegeId, uid, leaveTypeCode, year, pending: Math.max(0, (data.pending ?? 0) - days), updatedAt: new Date() },
    { merge: true }
  );
}
