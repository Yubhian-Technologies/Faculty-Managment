/**
 * One-time repair: a department rename (college/departments PATCH changing
 * `name`) never cascades the new name into the many places that store a copy
 * of it as free text - other departments' own `secondaryDepartments`/
 * `managedDepartments`/`courseScopes[*].secondaryDepartments`, and Section
 * `department`/`secondaryDepartments`. A department renamed after those
 * references were set (or after sections were created from them) leaves them
 * pointing at the old string forever - and since `college/departments`
 * enforces name uniqueness only case-insensitively, the most common case is a
 * pure case/whitespace drift (e.g. a department created as "ARTIFICIAL
 * INTELLIGENCE AND MACHINE LEARNING" and later renamed to "Artificial
 * Intelligence and Machine Learning" in Title Case) - which used to silently
 * break every exact-string lookup built on top of it (a shared-first-year
 * branch's sections becoming unfindable for Distribute/Assign, an "already
 * cross-listed" chip disappearing, etc.).
 *
 * This script finds every such stale reference in `departments` and
 * `sections` (case-insensitively matches a real department's current name,
 * but isn't an exact match) and rewrites it to that department's current
 * canonical name. Anything that doesn't match ANY real department even
 * case-insensitively is reported separately as "orphaned" and left
 * untouched - that's a different problem (a genuinely deleted/renamed-beyond-
 * recognition department) this script isn't safe to guess at.
 *
 * Dry-run by default - prints a diff and writes nothing. Pass --apply to write.
 *
 * Usage:
 *   node scripts/fix-stale-department-name-refs.mjs
 *   node scripts/fix-stale-department-name-refs.mjs --apply
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
const norm = (s) => (s ?? "").trim().toLowerCase();

function fixArray(arr, byLowerName) {
  if (!Array.isArray(arr) || arr.length === 0) return { changed: false, value: arr };
  let changed = false;
  const value = arr.map((raw) => {
    const t = (raw ?? "").trim();
    if (!t) return raw;
    const canon = byLowerName.get(norm(t));
    if (canon && canon !== t) { changed = true; return canon; }
    return raw;
  });
  return { changed, value };
}

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  let totalDeptFields = 0;
  let totalSections = 0;
  const orphaned = [];

  for (const college of collegesSnap.docs) {
    const collegeRef = college.ref;
    const deptsSnap = await collegeRef.collection("departments").get();
    const byLowerName = new Map();
    for (const d of deptsSnap.docs) {
      const name = (d.data().name ?? "").trim();
      if (name) byLowerName.set(norm(name), name);
    }
    if (byLowerName.size === 0) continue;

    let printedHeader = false;
    const printHeader = () => {
      if (printedHeader) return;
      console.log(`\n=== College ${college.id} (${college.data().name ?? "?"}) ===`);
      printedHeader = true;
    };

    // Department docs: secondaryDepartments, managedDepartments, and each
    // courseScopes[*].secondaryDepartments.
    for (const d of deptsSnap.docs) {
      const dept = d.data();
      const patch = {};
      const label = `Department "${dept.name}"`;

      for (const field of ["secondaryDepartments", "managedDepartments"]) {
        const { changed, value } = fixArray(dept[field], byLowerName);
        if (changed) {
          printHeader();
          console.log(`  ${label}.${field}: [${(dept[field] ?? []).join(", ")}] -> [${value.join(", ")}]`);
          patch[field] = value;
          totalDeptFields++;
        }
      }

      const courseScopes = dept.courseScopes ?? {};
      const courseScopePatch = {};
      for (const [catalogId, scope] of Object.entries(courseScopes)) {
        const { changed, value } = fixArray(scope.secondaryDepartments, byLowerName);
        if (changed) {
          printHeader();
          console.log(`  ${label}.courseScopes[${catalogId}].secondaryDepartments: [${(scope.secondaryDepartments ?? []).join(", ")}] -> [${value.join(", ")}]`);
          courseScopePatch[`courseScopes.${catalogId}.secondaryDepartments`] = value;
          totalDeptFields++;
        }
      }

      if (Object.keys(patch).length > 0 || Object.keys(courseScopePatch).length > 0) {
        if (APPLY) {
          await d.ref.update({ ...patch, ...courseScopePatch, updatedAt: new Date() });
        }
      }
    }

    // Sections: department (exact-string owner) and secondaryDepartments.
    const sectionsSnap = await collegeRef.collection("sections").get();
    for (const d of sectionsSnap.docs) {
      const s = d.data();
      const patch = {};
      const deptTrim = (s.department ?? "").trim();
      if (deptTrim) {
        const canon = byLowerName.get(norm(deptTrim));
        if (canon && canon !== deptTrim) {
          printHeader();
          console.log(`  Section "${s.name}" (id=${d.id}).department: "${deptTrim}" -> "${canon}"`);
          patch.department = canon;
          totalSections++;
        } else if (!canon) {
          orphaned.push(`Section "${s.name}" (id=${d.id}) college=${college.id} department="${deptTrim}" has NO matching department at all`);
        }
      }
      const { changed, value } = fixArray(s.secondaryDepartments, byLowerName);
      if (changed) {
        printHeader();
        console.log(`  Section "${s.name}" (id=${d.id}).secondaryDepartments: [${(s.secondaryDepartments ?? []).join(", ")}] -> [${value.join(", ")}]`);
        patch.secondaryDepartments = value;
        totalSections++;
      }
      for (const raw of s.secondaryDepartments ?? []) {
        const t = (raw ?? "").trim();
        if (t && !byLowerName.has(norm(t))) {
          orphaned.push(`Section "${s.name}" (id=${d.id}) college=${college.id} secondaryDepartments has "${t}" with NO matching department at all`);
        }
      }

      if (Object.keys(patch).length > 0 && APPLY) {
        await d.ref.update({ ...patch, updatedAt: new Date() });
      }
    }
  }

  console.log(
    `\n${APPLY ? "Fixed" : "Would fix"} ${totalDeptFields} department field(s) and ${totalSections} section field(s).`
  );
  if (orphaned.length > 0) {
    console.log(`\n${orphaned.length} orphaned reference(s) found (no matching department even case-insensitively) - NOT auto-fixed, needs manual review:`);
    for (const o of orphaned) console.log("  " + o);
  }
  if (!APPLY) {
    console.log("\nDry run only - re-run with --apply to write these changes.");
  }
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
