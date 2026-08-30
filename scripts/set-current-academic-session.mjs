/**
 * Sets a college's "Current" Academic Year (Settings > Academic Year, the
 * `academicSessions` doc with isCurrent:true) - the same collection/shape
 * `/api/college/academic-sessions` POST/PATCH manage, used here for a
 * one-off correction rather than clicking through the UI.
 *
 * If a session doc with this exact `label` already exists, marks it current
 * (and every other doc not-current). Otherwise creates a new one, current,
 * and marks every existing doc not-current.
 *
 * Dry-run by default - prints what it would do and writes nothing. Pass
 * --apply to write.
 *
 * Usage:
 *   node scripts/set-current-academic-session.mjs --college=svecw --label=2024-2025
 *   node scripts/set-current-academic-session.mjs --college=svecw --label=2024-2025 --apply
 */
import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
const privateKey = rawKey.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
if (!getApps().length) {
  initializeApp({ credential: cert({ projectId: process.env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey }) });
}
const db = getFirestore();
const APPLY = process.argv.includes("--apply");

const KNOWN_COLLEGES = {
  vit: { id: "bc77d03b57194edeb006", name: "VISHNU INSTITUTE OF TECHNOLOGY" },
  svecw: { id: "6df56a45a69244238ca0", name: "SHRI VISHNU ENGINEERING COLLEGE FOR WOMEN" },
};
const collegeArg = process.argv.find((a) => a.startsWith("--college="));
const collegeKey = collegeArg ? collegeArg.slice("--college=".length) : null;
const college = collegeKey ? KNOWN_COLLEGES[collegeKey] : null;
const labelArg = process.argv.find((a) => a.startsWith("--label="));
const label = labelArg ? labelArg.slice("--label=".length) : null;

if (!college || !label) {
  console.log(`Usage: node scripts/set-current-academic-session.mjs --college=<${Object.keys(KNOWN_COLLEGES).join("|")}> --label=YYYY-YYYY [--apply]`);
  process.exit(1);
}

async function run() {
  const collegeRef = db.collection("colleges").doc(college.id);
  const collegeSnap = await collegeRef.get();
  if (!collegeSnap.exists) { console.log(`College ${college.id} not found.`); process.exit(1); }
  const collegeName = collegeSnap.data().name ?? "?";
  console.log(`College: ${collegeName} (${college.id})`);
  if (collegeName.trim().toUpperCase() !== college.name) {
    console.log(`  WARNING: college name doesn't match expected "${college.name}" - double-check before using --apply.`);
  }

  const sessionsRef = collegeRef.collection("academicSessions");
  const allSnap = await sessionsRef.get();
  console.log(`  Existing sessions: ${allSnap.docs.map((d) => `${d.data().label}${d.data().isCurrent ? " (current)" : ""}`).join(", ") || "none"}`);

  const target = allSnap.docs.find((d) => d.data().label === label);
  const now = new Date();
  const batch = db.batch();
  let writes = 0;

  for (const d of allSnap.docs) {
    const isCurrent = d.id === target?.id;
    if (Boolean(d.data().isCurrent) !== isCurrent) {
      console.log(`  ${APPLY ? "WRITE" : "PLAN "} ${d.data().label}: isCurrent ${d.data().isCurrent ?? false} -> ${isCurrent}`);
      if (APPLY) batch.update(d.ref, { isCurrent, updatedAt: now });
      writes++;
    }
  }
  if (!target) {
    console.log(`  ${APPLY ? "WRITE" : "PLAN "} create new session "${label}", isCurrent=true`);
    if (APPLY) {
      const ref = sessionsRef.doc();
      batch.set(ref, { collegeId: college.id, label, isCurrent: true, createdAt: now, updatedAt: now });
    }
    writes++;
  }

  console.log(`\nTotal changes: ${writes}`);
  if (APPLY && writes > 0) {
    await batch.commit();
    console.log("Committed.");
  } else if (!APPLY) {
    console.log("\nDry run only - re-run with --apply to write these changes.");
  }
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
