import type { Firestore } from "firebase-admin/firestore";
import type { LeaveBalance, LeaveTypeFull, EmployeeLeaveProfile, LeaveTypeCode, EffectiveLeaveCategory } from "@/types/leave";
import { LEAVE_TYPE_SEED } from "./seedData";
import { computeEffectiveCategory } from "./categoryEngine";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";

// Earned Leave's total balance (this year's base entitlement + whatever
// carries forward - see initBalancesForYear) never exceeds this. Once
// someone is sitting at the cap, nothing more carries forward the next year
// until they use some of it down - using even one day makes room for that
// much to carry forward again, back up to the cap, not on top of it.
export const EL_CARRY_FORWARD_CAP = 300;

// Earliest year the EL carry-forward chain ever backfills to, regardless of
// how much earlier a profile's actual dateOfJoining is - this app has no real
// leave-usage records before this year, so treating an earlier joining date
// as the chain's start would assume zero EL ever taken across years we have
// no actual data for, inflating the carried total. Once real historical
// leave records are imported (per-year `used`/`entitled` written directly
// onto the relevant year's leaveBalances doc), this stops mattering for
// those years - initBalancesForYear only ever backfills a year that doesn't
// already have a doc, so an imported year is never touched or overwritten by
// this fallback, and the chain carries forward from the real imported
// numbers instead.
export const EL_HISTORY_START_YEAR = 2024;

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
  const doj = profile.dateOfJoining as unknown as { toDate?: () => Date };
  const joiningYear = (doj?.toDate?.() ?? new Date(profile.dateOfJoining as unknown as string)).getFullYear();
  // The chain never backfills earlier than this, even for someone who joined
  // well before it - see EL_HISTORY_START_YEAR.
  const earliestChainYear = Math.max(joiningYear, EL_HISTORY_START_YEAR);

  const writes: Promise<unknown>[] = [];

  for (const lt of types) {
    if (!lt.isActive) continue;
    if (lt.rules.unlimited) continue; // OD - no balance tracked
    if (!lt.rules.eligibleCategories.includes(effectiveCategory)) continue;

    const docId = balanceDocId(uid, lt.code, year);
    const docRef = col.doc(docId);
    const snap = await docRef.get();
    if (snap.exists) continue;

    let entitled = computeEntitlement(lt, effectiveCategory);
    // Earned Leave carries forward: whatever was left unused at the end of
    // last year is added on top of this year's base entitlement (e.g. 6 base
    // + 3 unused last year = 9). Computed once, here, at the moment this
    // year's doc is first created - never recomputed afterwards, so later
    // changes to last year's `used` (e.g. an approval landing after this ran)
    // don't retroactively change an already-settled year.
    let carriedForward: number | undefined;
    if (lt.code === "EL") {
      let prevBalances = await loadBalances(db, collegeId, uid, year - 1);
      let prevEL = prevBalances.find((b) => b.leaveTypeCode === "EL");
      // Last year's own EL doc may never have been touched (nobody viewed
      // their balance or applied for leave that year) - without this, the
      // carry-forward chain silently breaks and resets to 0 the first time a
      // gap year is skipped, understating the true running total. Backfill it
      // first (recursively, in case several years in a row were skipped),
      // bounded by earliestChainYear - there's nothing to carry from before
      // that (either they hadn't joined yet, or it's before real leave data
      // exists in this system at all).
      if (!prevEL && year - 1 >= earliestChainYear) {
        await initBalancesForYear(db, collegeId, uid, profile, newJoiningYears, year - 1, types);
        prevBalances = await loadBalances(db, collegeId, uid, year - 1);
        prevEL = prevBalances.find((b) => b.leaveTypeCode === "EL");
      }
      if (prevEL) {
        const prevEntitled = prevEL.entitled ?? entitled;
        const unusedLastYear = Math.max(0, prevEntitled - (prevEL.used ?? 0));
        // Capped so this year's total (base + carried) never exceeds
        // EL_CARRY_FORWARD_CAP - see its own comment for why.
        carriedForward = Math.max(0, Math.min(unusedLastYear, EL_CARRY_FORWARD_CAP - entitled));
        entitled += carriedForward;
      }
    }

    const balance: Omit<LeaveBalance, "id"> = {
      collegeId,
      uid,
      leaveTypeCode: lt.code,
      year,
      entitled,
      used: 0,
      pending: 0,
      ...(carriedForward ? { carriedForward } : {}),
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

// Inverse of commitApproval - the requester cancelling an already-APPROVED
// request (see applications/[id]/route.ts CANCEL branch) restores whatever
// days that approval had committed to `used`, same as if it had never been
// approved. Never touches `pending` - approval already zeroed out whatever
// was reserved for it.
export async function releaseApproval(
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
    { collegeId, uid, leaveTypeCode, year, used: Math.max(0, (data.used ?? 0) - days), updatedAt: new Date() },
    { merge: true }
  );
}

// Balance is never reserved at submission (see applications/route.ts POST),
// and insufficient balance never blocks approval either - days beyond what's
// remaining are accepted and split off as Loss of Pay instead. If no balance
// doc exists yet (e.g. first request of this type, or balances were reset),
// entitled falls back to the profile's computed default - NOT zero, which was
// an earlier bug: a missing doc isn't the same as zero balance. Shared by
// every final-decision stage (HOD for standard types, Principal/Vice
// Principal and Management for the PENDING_PRINCIPAL/PENDING_MANAGEMENT
// stages) - see applications/[id]/route.ts and lib/leave/decideFinalStage.ts.
export async function splitLeaveDays(
  db: Firestore,
  collegeId: string,
  uid: string,
  lt: LeaveTypeFull,
  year: number,
  days: number
): Promise<{ withinBalance: number; lopDays: number }> {
  const balances = await loadBalances(db, collegeId, uid, year);
  const bal = balances.find((b) => b.leaveTypeCode === lt.code);
  let entitled = bal?.entitled;
  if (entitled === undefined) {
    const [profileSnap, settings] = await Promise.all([
      PROFILES_COL(collegeId, db).doc(uid).get(),
      loadCollegeSettings(db, collegeId),
    ]);
    const profile = { id: profileSnap.id, ...profileSnap.data() } as EmployeeLeaveProfile;
    entitled = computeEntitlement(lt, computeEffectiveCategory(profile, settings.newJoiningYears));
  }
  const remaining = Math.max(0, entitled - (bal?.used ?? 0));
  const withinBalance = Math.min(days, remaining);
  return { withinBalance, lopDays: days - withinBalance };
}
