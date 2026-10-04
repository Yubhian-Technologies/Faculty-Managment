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

// entitlementByCategory (a college's Settings > Leave Policy override, or a
// type's own seed default) takes precedence over the flat daysPerYear -
// EL is the one seed type that varies by category out of the box (vacation/
// teaching staff: 6 days; non-vacation/supporting staff: 30 days), but any
// type can now be given the same per-category split via that override.
export function computeEntitlement(leaveType: LeaveTypeFull, category: EffectiveLeaveCategory): number {
  if (leaveType.rules.unlimited) return 0;
  const byCategory = leaveType.rules.entitlementByCategory?.[category];
  if (byCategory !== undefined) return byCategory;
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
    // Carry-forward: whatever was left unused at the end of last year is
    // added on top of this year's base entitlement (e.g. 6 base + 3 unused
    // last year = 9). Computed once, here, at the moment this year's doc is
    // first created - never recomputed afterwards, so later changes to last
    // year's `used` (e.g. an approval landing after this ran) don't
    // retroactively change an already-settled year. EL carries forward by
    // seed default (see seedData.ts); any type can via the same
    // rules.carryForward override (see resolveLeaveTypes.ts).
    let carriedForward: number | undefined;
    if (lt.rules.carryForward?.enabled) {
      let prevBalances = await loadBalances(db, collegeId, uid, year - 1);
      let prevBal = prevBalances.find((b) => b.leaveTypeCode === lt.code);
      // Last year's own doc may never have been touched (nobody viewed their
      // balance or applied for leave that year) - without this, the
      // carry-forward chain silently breaks and resets to 0 the first time a
      // gap year is skipped, understating the true running total. Backfill it
      // first (recursively, in case several years in a row were skipped),
      // bounded by earliestChainYear - there's nothing to carry from before
      // that (either they hadn't joined yet, or it's before real leave data
      // exists in this system at all).
      if (!prevBal && year - 1 >= earliestChainYear) {
        await initBalancesForYear(db, collegeId, uid, profile, newJoiningYears, year - 1, types);
        prevBalances = await loadBalances(db, collegeId, uid, year - 1);
        prevBal = prevBalances.find((b) => b.leaveTypeCode === lt.code);
      }
      if (prevBal) {
        const prevEntitled = prevBal.entitled ?? entitled;
        const unusedLastYear = Math.max(0, prevEntitled - (prevBal.used ?? 0));
        const cap = lt.rules.carryForward.cap ?? Infinity;
        carriedForward = Math.max(0, Math.min(unusedLastYear, cap - entitled));
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

// Every helper below is a read-modify-write of ONE balance doc, so each runs
// in a transaction: the plain read-then-set these used to be loses an update
// whenever two land together (two approvals on used=0 left used=1; a cancel
// racing an approval on used=3 ended at 5 instead of 2 - audit probe
// 2026-10-03). They keep set(..., {merge: true}) semantics rather than
// update() - the balance doc isn't guaranteed to exist yet (e.g.
// initBalancesForYear hasn't run for this employee/type/year), and update()
// throws NOT_FOUND on a missing doc. set-merge upserts identity fields plus
// the new value either way; readers already fall back to a computed default
// when `entitled` is absent from a doc created this way.
//
// The arithmetic lives in the *Patch functions so a decision that must change
// the balance AND the request status in one transaction (decisionTx.ts) applies
// exactly the same numbers.

export interface BalanceCounters { used?: number; pending?: number; entitled?: number }

/** Approval: the committed days leave `pending` (floored at 0) and join `used`. */
export function commitPatch(data: BalanceCounters, days: number): { pending: number; used: number } {
  return { pending: Math.max(0, (data.pending ?? 0) - days), used: (data.used ?? 0) + days };
}

/** Rejection/cancel-while-pending: drop the reservation (floored at 0). */
export function releasePendingPatch(data: BalanceCounters, days: number): { pending: number } {
  return { pending: Math.max(0, (data.pending ?? 0) - days) };
}

/** Cancel-after-approval: give the committed days back (floored at 0). */
export function releaseApprovalPatch(data: BalanceCounters, days: number): { used: number } {
  return { used: Math.max(0, (data.used ?? 0) - days) };
}

export function balanceIdentity(collegeId: string, uid: string, leaveTypeCode: LeaveTypeCode, year: number) {
  return { collegeId, uid, leaveTypeCode, year };
}

async function mutateBalance(
  db: Firestore,
  collegeId: string,
  uid: string,
  leaveTypeCode: LeaveTypeCode,
  year: number,
  patch: (current: BalanceCounters) => Record<string, number>
): Promise<void> {
  const ref = BALANCES_COL(collegeId, db).doc(balanceDocId(uid, leaveTypeCode, year));
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() ?? {};
    tx.set(ref, { ...balanceIdentity(collegeId, uid, leaveTypeCode, year), ...patch(current), updatedAt: new Date() }, { merge: true });
  });
}

export async function commitApproval(
  db: Firestore,
  collegeId: string,
  uid: string,
  leaveTypeCode: LeaveTypeCode,
  year: number,
  days: number
): Promise<void> {
  await mutateBalance(db, collegeId, uid, leaveTypeCode, year, (cur) => commitPatch(cur, days));
}

// Nothing reserves `pending` any more (balance is only committed at the final
// approval - see applications/route.ts POST), so for current data this only
// writes pending: 0. It is still called on reject/cancel because (a) a balance
// doc written back when reservations existed can still hold pending > 0, and
// (b) the set-merge upsert it performs is part of the existing behaviour
// initBalancesForYear depends on (a doc that exists is never re-initialised).
// Changing either would risk shifting a visible entitlement, so it is kept
// as-is, just atomic.
export async function releasePending(
  db: Firestore,
  collegeId: string,
  uid: string,
  leaveTypeCode: LeaveTypeCode,
  year: number,
  days: number
): Promise<void> {
  await mutateBalance(db, collegeId, uid, leaveTypeCode, year, (cur) => releasePendingPatch(cur, days));
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
  await mutateBalance(db, collegeId, uid, leaveTypeCode, year, (cur) => releaseApprovalPatch(cur, days));
}

// The entitlement to assume when no balance doc (or one without `entitled`)
// exists yet - the profile's computed default, NOT zero.
export async function computeFallbackEntitled(
  db: Firestore,
  collegeId: string,
  uid: string,
  lt: LeaveTypeFull
): Promise<number> {
  const [profileSnap, settings] = await Promise.all([
    PROFILES_COL(collegeId, db).doc(uid).get(),
    loadCollegeSettings(db, collegeId),
  ]);
  const profile = { id: profileSnap.id, ...profileSnap.data() } as EmployeeLeaveProfile;
  return computeEntitlement(lt, computeEffectiveCategory(profile, settings.newJoiningYears));
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
  const entitled = bal?.entitled ?? (await computeFallbackEntitled(db, collegeId, uid, lt));
  const remaining = Math.max(0, entitled - (bal?.used ?? 0));
  const withinBalance = Math.min(days, remaining);
  return { withinBalance, lopDays: days - withinBalance };
}
