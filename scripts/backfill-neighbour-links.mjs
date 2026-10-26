/**
 * Phase 1.5 backfill: writes Department.neighbourLinks for every department, computed by
 * resolveNeighbourLinks (scripts/lib/neighbourLinksCore.mjs, mirrored in
 * src/lib/departments/neighbourLinks.ts - see that file's own doc-comment).
 *
 * ADVISORY/DISPLAY ONLY: no authorization path reads this field - scope.ts/managedBranches.ts
 * keep resolving real teaching-assignment authority by calling findBranchManager() directly,
 * exactly as before this field existed. See Department.neighbourLinks's own doc-comment,
 * src/types/core.ts.
 *
 * Writes [] (clears) for a department with no resolved manager, same as any other value - this
 * is a denormalized mirror, not a sticky flag, so a department that stops being fed loses its
 * stale link on the next run.
 *
 * DRY RUN by default; --apply writes, after saving a JSON backup of every department it will
 * change (backups/, git-ignored). Idempotent: running it again after --apply finds nothing left
 * to do.
 *
 * Usage:
 *   node scripts/backfill-neighbour-links.mjs [--college=<id>]           -> dry run
 *   node scripts/backfill-neighbour-links.mjs [--college=<id>] --apply
 */
import { init, parseArgs, writeBackup, banner } from "./lib/scriptKit.mjs";
import { resolveNeighbourLinks } from "./lib/neighbourLinksCore.mjs";

const { apply, opt } = parseArgs();
const { db } = init();
banner(apply);

const sameLinks = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

const only = opt("college");
const colleges = only ? [db.collection("colleges").doc(only)] : (await db.collection("colleges").get()).docs.map((d) => d.ref);

for (const college of colleges) {
  const name = (await college.get()).data()?.name ?? college.id;
  const snap = await college.collection("departments").get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (all.length === 0) continue;

  const toWrite = [];
  for (const doc of snap.docs) {
    const dept = all.find((d) => d.id === doc.id);
    const links = resolveNeighbourLinks(dept, all);
    if (sameLinks(dept.neighbourLinks, links)) continue; // already correct - idempotent no-op
    toWrite.push({ ref: doc.ref, before: dept, links });
  }

  console.log(`${name}: ${toWrite.length} department(s) to write`);
  for (const w of toWrite.filter((w) => w.links.length > 0)) console.log(`    ${w.before.name} -> ${w.links.map((l) => `${l.neighbourDepartmentName} (years ${l.years.join(",")})`).join("; ")}`);
  if (!apply || toWrite.length === 0) continue;

  const backup = toWrite.map((w) => ({ path: w.ref.path, before: w.before }));
  console.log(`  backup: ${writeBackup(`neighbour-links-${college.id}`, backup)}`);
  let batch = db.batch(), n = 0;
  const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };
  for (const w of toWrite) {
    batch.update(w.ref, { neighbourLinks: w.links });
    if (++n >= 400) await flush();
  }
  await flush();
  console.log("  done.");
}
