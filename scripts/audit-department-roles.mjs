/**
 * READ-ONLY. Never writes to Firestore.
 * Classifies every department of every college into the PARENT/CHILD/GHOST/NEIGHBOUR/NEIGHBOUR_SUB
 * vocabulary (see src/lib/departments/departmentRole.ts - this is its plain-JS mirror,
 * scripts/lib/departmentRoleCore.mjs) and flags contradictions for manual review. Fixes nothing.
 *
 *   node scripts/audit-department-roles.mjs                  -> every college, summary + CSV per college
 *   node scripts/audit-department-roles.mjs --college=<id>   -> one college only
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { init, parseArgs } from "./lib/scriptKit.mjs";
import { deriveDepartmentRole } from "./lib/departmentRoleCore.mjs";

const { opt } = parseArgs();
const { db } = init();
console.log("READ-ONLY department role audit (nothing is written to the database)\n");

const csv = (cells) => cells.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",");
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "backups");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const only = opt("college");
const collegeRefs = only ? [db.collection("colleges").doc(only)] : (await db.collection("colleges").get()).docs.map((d) => d.ref);

let totalFlags = 0;
for (const collegeRef of collegeRefs) {
  const collegeSnap = await collegeRef.get();
  const collegeName = collegeSnap.data()?.name ?? collegeRef.id;
  const snap = await collegeRef.collection("departments").get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (all.length === 0) continue;

  const rows = all.map((dept) => {
    const { role, flags } = deriveDepartmentRole(dept, all);
    return { id: dept.id, name: dept.name ?? "", code: dept.code ?? "", role, flags };
  });

  const flagged = rows.filter((r) => r.flags.length > 0);
  totalFlags += flagged.length;
  console.log(`${collegeRef.id}\t${collegeName}\tdepartments=${rows.length}\tflagged=${flagged.length}`);
  for (const r of flagged) console.log(`    ${r.name} (${r.id}): ${r.flags.join(", ")}`);

  const lines = [csv(["id", "name", "code", "role", "flags"])];
  for (const r of rows) lines.push(csv([r.id, r.name, r.code, r.role, r.flags.join("; ")]));
  const file = join(outDir, `department-roles-${collegeRef.id}-${stamp}.csv`);
  writeFileSync(file, lines.join("\n"));
}

console.log(`\nTotal flagged across all audited colleges: ${totalFlags}`);
