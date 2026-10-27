/**
 * Phase 1 backfill: writes Department.departmentRole / departmentRoleSource = "DERIVED" for
 * every department, computed by deriveDepartmentRole (scripts/lib/departmentRoleCore.mjs, mirrored
 * in src/lib/departments/departmentRole.ts - see that file's own doc-comment).
 *
 * ADVISORY ONLY: nothing in scope.ts/academicStructure.ts/managedBranches.ts/taughtYears.ts or any
 * API route reads this field - see Department.departmentRole's own doc-comment, src/types/core.ts.
 * UI badges call deriveDepartmentRole LIVE, never trusting this stored copy.
 *
 * The classifier always picks one of the 5 roles (it never returns "unknown"), so every department
 * gets written - a department with a contradiction flag (e.g. GHOST_HAS_OWN_YEARS) is written the
 * same as any other AND printed separately under REVIEW. Run scripts/audit-department-roles.mjs
 * first and read every flagged department before trusting this script's dry run.
 *
 * Skips (never overwrites) a department whose Principal already set departmentRoleSource=
 * "PRINCIPAL_SET" - that explicit answer always wins.
 *
 * DRY RUN by default; --apply writes, after saving a JSON backup of every department it will change
 * (backups/, git-ignored). Idempotent: running it again after --apply finds nothing left to do.
 *
 * Usage:
 *   node scripts/backfill-department-roles.mjs [--college=<id>]           -> dry run
 *   node scripts/backfill-department-roles.mjs [--college=<id>] --apply
 */
import { init, parseArgs, writeBackup, banner } from "./lib/scriptKit.mjs";
import { deriveDepartmentRole } from "./lib/departmentRoleCore.mjs";

const { apply, opt } = parseArgs();
const { db } = init();
banner(apply);

const only = opt("college");
const colleges = only ? [db.collection("colleges").doc(only)] : (await db.collection("colleges").get()).docs.map((d) => d.ref);

for (const college of colleges) {
  const name = (await college.get()).data()?.name ?? college.id;
  const snap = await college.collection("departments").get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (all.length === 0) continue;

  const toWrite = [];
  const flaggedForReview = [];
  for (const doc of snap.docs) {
    const dept = all.find((d) => d.id === doc.id);
    if (dept.departmentRoleSource === "PRINCIPAL_SET") continue;
    const { role, flags } = deriveDepartmentRole(dept, all);
    if (flags.length > 0) flaggedForReview.push({ name: dept.name, id: dept.id, role, flags });
    if (dept.departmentRole === role && dept.departmentRoleSource === "DERIVED") continue; // already correct - idempotent no-op
    toWrite.push({ ref: doc.ref, before: dept, role });
  }

  console.log(`${name}: ${toWrite.length} department(s) to write, ${flaggedForReview.length} flagged for manual review`);
  for (const f of flaggedForReview) console.log(`    REVIEW ${f.name} (${f.id}) -> ${f.role}: ${f.flags.join(", ")}`);
  if (!apply || toWrite.length === 0) continue;

  const backup = toWrite.map((w) => ({ path: w.ref.path, before: w.before }));
  console.log(`  backup: ${writeBackup(`department-roles-${college.id}`, backup)}`);
  let batch = db.batch(), n = 0;
  const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };
  for (const w of toWrite) {
    batch.update(w.ref, { departmentRole: w.role, departmentRoleSource: "DERIVED" });
    if (++n >= 400) await flush();
  }
  await flush();
  console.log("  done.");
}
