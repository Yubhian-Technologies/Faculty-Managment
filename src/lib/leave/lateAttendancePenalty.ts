import type { Firestore } from "firebase-admin/firestore";
import { BALANCES_COL, REQUESTS_COL, balanceDocId } from "./balanceEngine";

const LATE_CHECKINS_PER_PENALTY = 3;
const PENALTY_DAYS = 0.5;

export const LATE_COUNTERS_COL = (collegeId: string, db: Firestore) =>
  db.collection("colleges").doc(collegeId).collection("lateAttendanceCounters");

function counterDocId(uid: string, year: number) {
  return `${uid}_${year}`;
}

// Every 3rd late check-in accumulated across the whole calendar year (not
// reset monthly) auto-deducts 0.5 Casual Leave, and repeats for every further
// group of 3 (6th late -> another 0.5, 9th -> another, ...) - called from
// check-in/route.ts right after a late check-in is recorded. Never blocks the
// check-in response if it fails - see the try/catch at its call site.
//
// The deduction is recorded two ways so it shows up everywhere a real leave
// deduction would: directly on the CL leaveBalances doc (used += 0.5, same
// field commitApproval() mutates), and as an auto-APPROVED LeaveRequest doc
// tagged isLateAttendancePenalty so it appears in the CL/"All" leave history
// list the same as any other request - see LeaveHistoryRow.
export async function recordLateCheckIn(
  db: Firestore,
  collegeId: string,
  uid: string,
  employeeName: string,
  department: string,
  today: Date
): Promise<void> {
  const year = today.getFullYear();
  const counterRef = LATE_COUNTERS_COL(collegeId, db).doc(counterDocId(uid, year));
  const balanceRef = BALANCES_COL(collegeId, db).doc(balanceDocId(uid, "CL", year));
  const requestRef = REQUESTS_COL(collegeId, db).doc();
  const now = new Date();

  await db.runTransaction(async (tx) => {
    // Both reads happen before any write - Firestore transactions require
    // every get() to precede every set()/update(). The balance doc is read
    // unconditionally even though it's only written on a 3rd/6th/9th... late
    // check-in, since whether this is one of those isn't known until after
    // the counter read below.
    const [counterSnap, balanceSnap] = await Promise.all([tx.get(counterRef), tx.get(balanceRef)]);
    const count = ((counterSnap.data()?.count as number | undefined) ?? 0) + 1;

    tx.set(counterRef, { collegeId, uid, year, count, updatedAt: now }, { merge: true });

    if (count % LATE_CHECKINS_PER_PENALTY !== 0) return;

    const balanceData = balanceSnap.data() ?? {};
    tx.set(
      balanceRef,
      {
        collegeId, uid, leaveTypeCode: "CL", year,
        used: (balanceData.used as number | undefined ?? 0) + PENALTY_DAYS,
        updatedAt: now,
      },
      { merge: true }
    );

    tx.set(requestRef, {
      collegeId,
      uid,
      employeeName,
      department,
      leaveTypeCode: "CL",
      fromDate: today,
      toDate: today,
      totalDays: PENALTY_DAYS,
      reason: `Automatic deduction — reached ${count} late check-ins this year (every 3 late check-ins deducts 0.5 Casual Leave)`,
      status: "APPROVED",
      isLateAttendancePenalty: true,
      createdAt: now,
      updatedAt: now,
    });
  });
}

// Reverses recordLateCheckIn's effect for one specific late check-in date -
// used when an HOD retroactively grants check-in permission for a day that
// already has a late check-in recorded (see check-in-permission/route.ts) -
// the live check-in route only ever resolves a permission AT THE MOMENT of
// check-in, so a permission granted afterward (the common real flow: HOD
// sees someone arrived late, then excuses it) would otherwise leave the
// record's counter/deduction stuck as if it were still late.
//
// Decrements the running per-year counter by one (this date no longer counts
// toward any future 3rd/6th/9th... grouping) - and if THIS exact date was
// the one that actually triggered a 0.5 CL deduction (a matching
// isLateAttendancePenalty leaveRequest exists dated that day), reverses that
// too: restores the balance and removes the record so leave history doesn't
// keep showing a penalty that no longer applies. Deliberately NOT a full
// renumbering of every later date's grouping (e.g. a later date that became
// "the" 3rd late check-in only because this one was excused first still
// keeps whatever it was originally assigned) - a rare, accepted imprecision
// in exchange for staying simple and safe to run as one isolated correction.
export async function reverseLateCheckIn(
  db: Firestore,
  collegeId: string,
  uid: string,
  date: Date,
): Promise<void> {
  const year = date.getFullYear();
  const counterRef = LATE_COUNTERS_COL(collegeId, db).doc(counterDocId(uid, year));
  const balanceRef = BALANCES_COL(collegeId, db).doc(balanceDocId(uid, "CL", year));

  // fromDate on the penalty doc is always the same zero-time-of-day
  // construction recordLateCheckIn's caller uses (see check-in/route.ts's
  // todayDocDate / import route's date), so an equality match on that same
  // construction is exact - no range query (and its composite-index
  // requirement) needed.
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const penaltySnap = await REQUESTS_COL(collegeId, db)
    .where("uid", "==", uid)
    .where("isLateAttendancePenalty", "==", true)
    .where("fromDate", "==", dayStart)
    .limit(1)
    .get();
  const penaltyRef = penaltySnap.empty ? null : penaltySnap.docs[0].ref;

  const now = new Date();
  await db.runTransaction(async (tx) => {
    const [counterSnap, balanceSnap, penaltySnapshot] = await Promise.all([
      tx.get(counterRef),
      tx.get(balanceRef),
      penaltyRef ? tx.get(penaltyRef) : Promise.resolve(null),
    ]);
    const count = Math.max(0, ((counterSnap.data()?.count as number | undefined) ?? 0) - 1);
    tx.set(counterRef, { collegeId, uid, year, count, updatedAt: now }, { merge: true });

    if (penaltyRef && penaltySnapshot?.exists) {
      const balanceData = balanceSnap.data() ?? {};
      tx.set(
        balanceRef,
        {
          collegeId, uid, leaveTypeCode: "CL", year,
          used: Math.max(0, (balanceData.used as number | undefined ?? 0) - PENALTY_DAYS),
          updatedAt: now,
        },
        { merge: true },
      );
      tx.delete(penaltyRef);
    }
  });
}
