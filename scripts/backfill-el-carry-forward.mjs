/**
 * Backfills Earned Leave's carry-forward chain for every employee leave
 * profile, using the exact same rules as src/lib/leave/balanceEngine.ts:
 *   - EL_HISTORY_START_YEAR = 2024 - the chain never reaches earlier than
 *     this, even for someone who joined years before (no real leave records
 *     exist before this system did).
 *   - EL_CARRY_FORWARD_CAP = 300 - a year's carried-forward amount is capped
 *     so the running total (base + carried) never exceeds 300.
 *
 * For each profile (vacation/non-vacation category only - "new-joining"
 * isn't EL-eligible), walks 2024 through the current year:
 *   - Creates any missing year's EL balance doc (base entitlement only,
 *     used=0, pending=0) - this only ever happens for a year with no doc at
 *     all, so it never overwrites anything real.
 *   - For a year whose doc already exists, ONLY corrects `entitled` and
 *     `carriedForward` (recomputed from the now-complete chain) - `used` and
 *     `pending` are left completely untouched, so any leave someone has
 *     actually taken this year is preserved exactly.
 *
 * This exists because the carry-forward cap/chain fix landed in code after
 * some balance docs were already created (with no carry-forward, since the
 * old code had nothing to backfill from) - those docs are idempotently
 * skipped by the app going forward (initBalancesForYear never touches a doc
 * that already exists), so they need this one-time correction. Once real
 * historical leave data is imported for 2024/2025, re-run this script (or
 * just let it be - it only fills gaps, never overwrites an already-correct
 * entitled/carriedForward pair) to keep the chain consistent.
 *
 * Usage: node scripts/backfill-el-carry-forward.mjs           (dry run - prints only)
 *        node scripts/backfill-el-carry-forward.mjs --apply   (writes)
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const EL_HISTORY_START_YEAR = 2024;
const EL_CARRY_FORWARD_CAP = 300;
const CURRENT_YEAR = new Date().getFullYear();

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

function baseEntitlement(category) {
  return category === "vacation" ? 6 : 30; // EL only - see computeEntitlement in balanceEngine.ts
}

function effectiveCategory(profile, newJoiningYears) {
  const doj = profile.dateOfJoining?.toDate ? profile.dateOfJoining.toDate() : new Date(profile.dateOfJoining);
  const now = new Date();
  let years = now.getFullYear() - doj.getFullYear();
  const anniversaryPassed =
    now.getMonth() > doj.getMonth() || (now.getMonth() === doj.getMonth() && now.getDate() >= doj.getDate());
  if (!anniversaryPassed) years -= 1;
  years = Math.max(0, years);
  return years < newJoiningYears ? "new-joining" : profile.staffCategory;
}

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  let profilesChecked = 0;
  let docsCreated = 0;
  let docsCorrected = 0;

  for (const collegeDoc of collegesSnap.docs) {
    const collegeId = collegeDoc.id;
    const settingsSnap = await collegeDoc.ref.collection("settings").doc("general").get();
    const newJoiningYears = settingsSnap.exists ? (settingsSnap.data().newJoiningYears ?? 1) : 1;

    const profilesSnap = await collegeDoc.ref.collection("employeeLeaveProfiles").get();
    if (profilesSnap.empty) continue;

    console.log(`\n=== College ${collegeId} (${collegeDoc.data().name ?? "?"}) - ${profilesSnap.size} profile(s) ===`);

    for (const profileDoc of profilesSnap.docs) {
      const profile = profileDoc.data();
      const uid = profileDoc.id;
      const category = effectiveCategory(profile, newJoiningYears);
      if (category !== "vacation" && category !== "non-vacation") continue; // new-joining - not EL-eligible yet
      profilesChecked++;

      const joiningYear = (profile.dateOfJoining?.toDate ? profile.dateOfJoining.toDate() : new Date(profile.dateOfJoining)).getFullYear();
      const startYear = Math.max(joiningYear, EL_HISTORY_START_YEAR);
      if (startYear > CURRENT_YEAR) continue; // hasn't joined yet as of this chain's floor

      // Load every year's existing EL doc up front.
      const balCol = collegeDoc.ref.collection("leaveBalances");
      const existing = new Map();
      for (let y = startYear; y <= CURRENT_YEAR; y++) {
        const docId = `${uid}_EL_${y}`;
        const snap = await balCol.doc(docId).get();
        if (snap.exists) existing.set(y, { id: docId, ...snap.data() });
      }

      let prevEntitled = null;
      let prevUsed = null;
      for (let y = startYear; y <= CURRENT_YEAR; y++) {
        const base = baseEntitlement(category);
        let carriedForward;
        if (prevEntitled === null) {
          carriedForward = 0; // first year in the chain - nothing to carry
        } else {
          const unusedLastYear = Math.max(0, prevEntitled - prevUsed);
          carriedForward = Math.max(0, Math.min(unusedLastYear, EL_CARRY_FORWARD_CAP - base));
        }
        const entitled = base + carriedForward;

        const doc = existing.get(y);
        if (!doc) {
          console.log(`  [create] uid=${uid} year=${y} entitled=${entitled}${carriedForward ? ` (carried ${carriedForward})` : ""}`);
          if (APPLY) {
            await balCol.doc(`${uid}_EL_${y}`).set({
              collegeId, uid, leaveTypeCode: "EL", year: y, entitled, used: 0, pending: 0,
              ...(carriedForward ? { carriedForward } : {}),
              updatedAt: new Date(),
            });
          }
          docsCreated++;
          prevEntitled = entitled;
          prevUsed = 0;
        } else {
          const needsFix = doc.entitled !== entitled || (doc.carriedForward ?? 0) !== carriedForward;
          if (needsFix) {
            console.log(
              `  [fix]    uid=${uid} year=${y} entitled ${doc.entitled} -> ${entitled}` +
                `, carriedForward ${doc.carriedForward ?? 0} -> ${carriedForward} (used=${doc.used ?? 0} untouched)`
            );
            if (APPLY) {
              await balCol.doc(doc.id).update({
                entitled,
                carriedForward: carriedForward ? carriedForward : FieldValue.delete(),
                updatedAt: new Date(),
              });
            }
            docsCorrected++;
          }
          // Next year's carry-forward basis: the just-recomputed `entitled`
          // (matches what the doc now holds, whether just corrected or
          // already right) paired with the doc's REAL `used` - `used`
          // reflects actual leave taken, which this script must never guess
          // at or overwrite.
          prevEntitled = entitled;
          prevUsed = doc.used ?? 0;
        }
      }
    }
  }

  console.log(
    `\n${APPLY ? "APPLIED" : "DRY RUN (pass --apply to write)"} - checked ${profilesChecked} EL-eligible profile(s), ` +
      `${docsCreated} doc(s) to create, ${docsCorrected} doc(s) to correct.`
  );
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
