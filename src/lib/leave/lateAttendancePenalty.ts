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
