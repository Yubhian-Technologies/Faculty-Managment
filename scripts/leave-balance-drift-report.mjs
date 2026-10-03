/**
 * READ-ONLY leave balance drift report.
 *
 * Recomputes `used` for every employee / leave type / year from the APPROVED
 * leave requests and reports where it differs from the stored leaveBalances
 * doc, so you can see whether production balances are already wrong (the
 * balance helpers were not atomic until 2026-10-03, so concurrent approvals
 * could have lost or double-counted days).
 *
 * It NEVER writes to Firestore. The only file it writes is the JSON report,
 * under backups/. It does not fix anything - decide what to do from the report.
 *
 * Reads Admin SDK credentials from .env (FIREBASE_ADMIN_*) - the project id is
 * printed first so you can confirm which environment you are pointing at.
 *
 * Usage:
 *   node scripts/leave-balance-drift-report.mjs                 # every college, every year
 *   node scripts/leave-balance-drift-report.mjs --college <id>  # one college
 *   node scripts/leave-balance-drift-report.mjs --year 2026
 *
 * Known, accepted noise to expect in the output:
 *   - USED_WITHOUT_APPROVED_REQUESTS: opening balances / imported history
 *     (leave-history-report/import writes `used` directly).
 *   - The year of a request is the server-local year of its fromDate, exactly
 *     as the engine computes it today (the IST year-boundary question, L5, is
 *     intentionally not applied here).
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { computeLeaveBalanceDrift } from "./lib/leaveDrift.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const onlyCollege = flag("college");
const onlyYear = flag("year") ? Number(flag("year")) : undefined;

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}
const db = getFirestore();

console.log(`READ-ONLY drift report - project: ${process.env.FIREBASE_ADMIN_PROJECT_ID}`);

const collegeDocs = onlyCollege
  ? [await db.collection("colleges").doc(onlyCollege).get()]
  : (await db.collection("colleges").get()).docs;

const report = { generatedAt: new Date().toISOString(), project: process.env.FIREBASE_ADMIN_PROJECT_ID, colleges: [] };

for (const college of collegeDocs) {
  if (!college.exists) { console.log(`college ${college.id}: not found`); continue; }
  const ref = db.collection("colleges").doc(college.id);
  let balanceQuery = ref.collection("leaveBalances");
  if (onlyYear) balanceQuery = balanceQuery.where("year", "==", onlyYear);
  const [balanceSnap, requestSnap] = await Promise.all([
    balanceQuery.get(),
    ref.collection("leaveRequests").where("status", "==", "APPROVED").get(),
  ]);
  const balances = balanceSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  let requests = requestSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (onlyYear) requests = requests.filter((r) => r.fromDate?.toDate?.().getFullYear() === onlyYear);

  const result = computeLeaveBalanceDrift({ balances, requests });
  report.colleges.push({ collegeId: college.id, name: college.data()?.name ?? null, ...result });
  console.log(
    `college ${college.id} (${college.data()?.name ?? "?"}): ${result.checkedBalances} balances, ` +
      `${result.approvedRequestsCounted} approved requests -> ${result.driftRows} drifted ${JSON.stringify(result.byKind)}`
  );
}

mkdirSync("backups", { recursive: true });
const file = `backups/leave-balance-drift-${report.generatedAt.replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`\nReport written to ${file}  (nothing in Firestore was modified)`);
