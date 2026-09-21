/**
 * One-time migration: the DEAN role was renamed ACADEMICS. Rewrites every stored
 * occurrence so nothing is left pointing at the old name.
 *
 * Covers:
 *   - colleges/{id}/users            role, seatRoles[]
 *   - systemUsers                    role
 *   - colleges/{id}/roleSeats        role, label ("Dean", "Dean 2", ...)
 *   - roleSeats/{id}/history         role, seatLabel
 *   - colleges/{id}/settings/navVisibility  hiddenModules / hiddenItems key DEAN
 *   - Firebase Auth custom claims    role
 *
 * Dry run by default (prints what it would change). Add --apply to write.
 * Safe to re-run: already-migrated docs are skipped.
 *
 * Usage: node scripts/migrate-dean-to-academics.mjs [--apply]
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");

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
const auth = getAuth();
const counts = { users: 0, systemUsers: 0, seats: 0, history: 0, navVisibility: 0, claims: 0 };

const relabel = (s) => (typeof s === "string" ? s.replace(/\bDean\b/g, "Academics") : s);

async function write(ref, data) {
  if (APPLY) await ref.update(data);
}

async function run() {
  console.log(APPLY ? "APPLYING changes" : "DRY RUN (no writes) - pass --apply to write");

  const colleges = await db.collection("colleges").get();
  for (const college of colleges.docs) {
    const cRef = college.ref;

    // users: primary role and seat list
    const usersSnap = await cRef.collection("users").get();
    for (const u of usersSnap.docs) {
      const d = u.data();
      const patch = {};
      if (d.role === "DEAN") patch.role = "ACADEMICS";
      if (Array.isArray(d.seatRoles) && d.seatRoles.includes("DEAN")) {
        patch.seatRoles = d.seatRoles.map((r) => (r === "DEAN" ? "ACADEMICS" : r));
      }
      if (Object.keys(patch).length) {
        counts.users++;
        console.log(`  users/${u.id} (${cRef.id}):`, JSON.stringify(patch));
        await write(u.ref, patch);
      }
    }

    // seats and their history
    const seatsSnap = await cRef.collection("roleSeats").get();
    for (const s of seatsSnap.docs) {
      const d = s.data();
      const patch = {};
      if (d.role === "DEAN") patch.role = "ACADEMICS";
      if (relabel(d.label) !== d.label) patch.label = relabel(d.label);
      if (Object.keys(patch).length) {
        counts.seats++;
        console.log(`  roleSeats/${s.id} (${cRef.id}):`, JSON.stringify(patch));
        await write(s.ref, patch);
      }
      const hist = await s.ref.collection("history").get();
      for (const h of hist.docs) {
        const hd = h.data();
        const hp = {};
        if (hd.role === "DEAN") hp.role = "ACADEMICS";
        if (relabel(hd.seatLabel) !== hd.seatLabel) hp.seatLabel = relabel(hd.seatLabel);
        if (Object.keys(hp).length) {
          counts.history++;
          await write(h.ref, hp);
        }
      }
    }

    // per-role nav visibility settings
    const navRef = cRef.collection("settings").doc("navVisibility");
    const nav = await navRef.get();
    if (nav.exists) {
      const d = nav.data();
      const patch = {};
      for (const field of ["hiddenModules", "hiddenItems"]) {
        if (d[field] && Object.prototype.hasOwnProperty.call(d[field], "DEAN")) {
          const { DEAN, ...rest } = d[field];
          patch[field] = { ...rest, ACADEMICS: DEAN };
        }
      }
      if (Object.keys(patch).length) {
        counts.navVisibility++;
        console.log(`  settings/navVisibility (${cRef.id}): DEAN -> ACADEMICS`);
        await write(navRef, patch);
      }
    }
  }

  // systemUsers pointer docs + auth custom claims
  const sys = await db.collection("systemUsers").where("role", "==", "DEAN").get();
  for (const s of sys.docs) {
    counts.systemUsers++;
    console.log(`  systemUsers/${s.id}`);
    await write(s.ref, { role: "ACADEMICS" });
    try {
      const user = await auth.getUser(s.id);
      const claims = user.customClaims ?? {};
      if (claims.role === "DEAN") {
        counts.claims++;
        if (APPLY) await auth.setCustomUserClaims(s.id, { ...claims, role: "ACADEMICS" });
      }
    } catch (e) {
      console.warn(`  (no auth user for ${s.id}: ${e.message})`);
    }
  }

  console.log("\nSummary:", counts);
  if (!APPLY) console.log("Nothing was written. Re-run with --apply to migrate.");
  else console.log("Done. People with an open session must sign in again to pick up the new role.");
}

run().catch((e) => { console.error(e); process.exit(1); });
