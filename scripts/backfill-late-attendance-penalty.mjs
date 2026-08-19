/**
 * One-time backfill: recordLateCheckIn() (see src/lib/leave/lateAttendancePenalty.ts)
 * only ever got called from the live self-check-in route until the import and
 * manual-mark routes were fixed to call it too - any attendanceRecord with a
 * late checkIn written BEFORE that fix (via import or an HOD/unit-head manual
 * mark) never counted toward the "3 late check-ins -> 0.5 CL" penalty. This
 * catches those up: for each employee, compares how many late checkIns they
 * actually have on record for a year against lateAttendanceCounters' stored
 * count for that year, and replays recordLateCheckIn for whatever's missing,
 * in date order, using each record's own date - so the same deduction lands
 * on the same 3rd/6th/9th... late day it would have if the fix had been live
 * from the start.
 *
 * This is shared production data across every real college, not a sandbox -
 * a single-college run is the safer default; --all-colleges is opt-in and
 * deliberate. Dry-run by default either way - prints a report and writes
 * nothing. Pass --apply to write.
 *
 * Usage:
 *   node scripts/backfill-late-attendance-penalty.mjs <collegeId>
 *   node scripts/backfill-late-attendance-penalty.mjs <collegeId> --apply
 *   node scripts/backfill-late-attendance-penalty.mjs <collegeId> --uid=<uid>   # single employee only
 *   node scripts/backfill-late-attendance-penalty.mjs --all-colleges
 *   node scripts/backfill-late-attendance-penalty.mjs --all-colleges --apply
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
const privateKey = rawKey.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

const db = getFirestore();
const APPLY = process.argv.includes("--apply");
const ALL_COLLEGES = process.argv.includes("--all-colleges");
const uidArg = process.argv.find((a) => a.startsWith("--uid="))?.split("=")[1];
const collegeIdArg = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;

if (!ALL_COLLEGES && !collegeIdArg) {
  console.error("Usage: node scripts/backfill-late-attendance-penalty.mjs <collegeId> [--apply] [--uid=<uid>]");
  console.error("   or: node scripts/backfill-late-attendance-penalty.mjs --all-colleges [--apply]");
  process.exit(1);
}

const LATE_CUTOFF_MINUTES = 9 * 60 + 5; // 09:05 - matches src/lib/attendance/lateStatus.ts
const LATE_CHECKINS_PER_PENALTY = 3;
const PENALTY_DAYS = 0.5;

function isLateCheckIn(checkIn) {
  if (!checkIn) return false;
  const m = /^(\d{1,2}):(\d{2})$/.exec(checkIn);
  if (!m) return false;
  return Number(m[1]) * 60 + Number(m[2]) > LATE_CUTOFF_MINUTES;
}

function counterDocId(uid, year) {
  return `${uid}_${year}`;
}
function balanceDocId(uid, code, year) {
  return `${uid}_${code}_${year}`;
}

// Mirrors recordLateCheckIn's transaction exactly (see lateAttendancePenalty.ts) -
// same collections, same fields, same every-3rd-late -> 0.5 CL rule.
async function recordLateCheckIn(collegeId, uid, employeeName, department, date) {
  const year = date.getFullYear();
  const collegeRef = db.collection("colleges").doc(collegeId);
  const counterRef = collegeRef.collection("lateAttendanceCounters").doc(counterDocId(uid, year));
  const balanceRef = collegeRef.collection("leaveBalances").doc(balanceDocId(uid, "CL", year));
  const requestRef = collegeRef.collection("leaveRequests").doc();
  const now = new Date();

  await db.runTransaction(async (tx) => {
    const [counterSnap, balanceSnap] = await Promise.all([tx.get(counterRef), tx.get(balanceRef)]);
    const count = (counterSnap.data()?.count ?? 0) + 1;
    tx.set(counterRef, { collegeId, uid, year, count, updatedAt: now }, { merge: true });
    if (count % LATE_CHECKINS_PER_PENALTY !== 0) return;
    const balanceData = balanceSnap.data() ?? {};
    tx.set(balanceRef, { collegeId, uid, leaveTypeCode: "CL", year, used: (balanceData.used ?? 0) + PENALTY_DAYS, updatedAt: now }, { merge: true });
    tx.set(requestRef, {
      collegeId, uid, employeeName, department, leaveTypeCode: "CL",
      fromDate: date, toDate: date, totalDays: PENALTY_DAYS,
      reason: `Automatic deduction — reached ${count} late check-ins this year (every 3 late check-ins deducts 0.5 Casual Leave) [backfilled]`,
      status: "APPROVED", isLateAttendancePenalty: true, createdAt: now, updatedAt: now,
    });
  });
}

async function processCollege(collegeId, collegeName) {
  const collegeRef = db.collection("colleges").doc(collegeId);

  const usersSnap = uidArg
    ? { docs: [await collegeRef.collection("users").doc(uidArg).get()].filter((d) => d.exists) }
    : await collegeRef.collection("users").get();

  let collegeDeductions = 0;
  let collegeTouched = false;

  for (const userDoc of usersSnap.docs) {
    const u = userDoc.data();
    const uid = userDoc.id;

    const attSnap = await collegeRef.collection("attendanceRecords").where("facultyId", "==", uid).get();
    const lateRecords = attSnap.docs
      .map((d) => d.data())
      .filter((r) => isLateCheckIn(r.checkIn))
      .map((r) => ({ date: r.date?.toDate ? r.date.toDate() : new Date(r.date) }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    if (lateRecords.length === 0) continue;

    const byYear = new Map();
    for (const r of lateRecords) {
      const y = r.date.getFullYear();
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(r.date);
    }

    for (const [year, dates] of byYear) {
      const counterSnap = await collegeRef.collection("lateAttendanceCounters").doc(counterDocId(uid, year)).get();
      const storedCount = counterSnap.data()?.count ?? 0;
      const actualCount = dates.length;
      if (actualCount <= storedCount) continue;

      const missing = dates.slice(storedCount);
      const dueDeductions = Math.floor(actualCount / LATE_CHECKINS_PER_PENALTY) - Math.floor(storedCount / LATE_CHECKINS_PER_PENALTY);
      if (!collegeTouched) {
        console.log(`\n=== ${collegeName} (${collegeId}) ===`);
        collegeTouched = true;
      }
      console.log(
        `  ${u.name ?? uid} (${uid}) ${year}: ${actualCount} late check-ins on record, counter at ${storedCount} - ` +
        `catching up ${missing.length} (${dueDeductions} new 0.5 CL deduction(s))`
      );
      collegeDeductions += dueDeductions;

      if (APPLY) {
        for (const date of missing) {
          await recordLateCheckIn(collegeId, uid, u.name ?? "", u.department ?? "", date);
        }
      }
    }
  }
  return collegeDeductions;
}

async function run() {
  console.log(APPLY ? "APPLY MODE - this will write real data" : "DRY RUN - no writes");

  let totalDeductions = 0;

  if (ALL_COLLEGES) {
    const collegesSnap = await db.collection("colleges").get();
    for (const collegeDoc of collegesSnap.docs) {
      totalDeductions += await processCollege(collegeDoc.id, collegeDoc.data().name ?? collegeDoc.id);
    }
  } else {
    const collegeSnap = await db.collection("colleges").doc(collegeIdArg).get();
    if (!collegeSnap.exists) {
      console.error(`No college found with id ${collegeIdArg}`);
      process.exit(1);
    }
    totalDeductions = await processCollege(collegeIdArg, collegeSnap.data().name ?? collegeIdArg);
  }

  console.log(`\n${APPLY ? "Applied" : "Would apply"}: ${totalDeductions} total 0.5-day CL deduction(s).`);
  if (!APPLY) console.log("Dry run only - re-run with --apply to write.");
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
