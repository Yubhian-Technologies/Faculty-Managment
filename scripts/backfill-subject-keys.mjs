/**
 * Prepares existing master subjects for the "one code, one name per course + regulation" rule:
 *   - writes the code lock and name lock (colleges/{id}/subjectKeys) for every subject,
 *   - stamps `catalogId` and `nameKey` on the subject,
 *   - upper-cases/trims a stored code that is not already (only when that cannot create a clash).
 * A subject that is part of a code/name clash is NEVER touched or keyed - run scripts/audit-subject-duplicates.mjs,
 * resolve those groups, then run this. Subjects with no courseId (the old semester-scoped shape) are left alone.
 *
 * DRY RUN by default; --apply writes, after saving a JSON backup of every subject it will change (backups/, git-ignored).
 * Idempotent: running it again after --apply finds nothing to do.
 *
 * Usage:
 *   node scripts/backfill-subject-keys.mjs --college=<id>           -> dry run
 *   node scripts/backfill-subject-keys.mjs --college=<id> --apply
 */
import { init, parseArgs, writeBackup, banner } from "./lib/scriptKit.mjs";
import { planSubjectKeys } from "./lib/subjectKeysCore.mjs";

const { apply, opt } = parseArgs();
const { db } = init();
banner(apply);

const only = opt("college");
const colleges = only ? [db.collection("colleges").doc(only)] : (await db.collection("colleges").get()).docs.map((d) => d.ref);
for (const college of colleges) {
  const name = (await college.get()).data()?.name ?? college.id;
  const [subjects, courses, keySnap] = await Promise.all([
    college.collection("subjects").get(),
    college.collection("courses").select("catalogId").get(),
    college.collection("subjectKeys").get(),
  ]);
  const plan = planSubjectKeys(subjects.docs.map((d) => ({ id: d.id, data: d.data() })), courses.docs.map((d) => ({ id: d.id, data: d.data() })));
  const have = new Map(keySnap.docs.map((d) => [d.id, d.get("subjectId")]));
  // A lock that already exists for the same subject is fine; one that points at ANOTHER subject is stale or a conflict - report it.
  const newKeys = plan.keys.filter((k) => have.get(k.id) !== k.subjectId);
  const foreign = plan.keys.filter((k) => have.has(k.id) && have.get(k.id) !== k.subjectId);
  const clashSubjects = new Set(plan.clashes.flatMap((c) => c.members.map((m) => m.id)));
  console.log(`${name}: ${newKeys.length} lock(s) to write, ${plan.subjectFixes.length} subject(s) to update, ${clashSubjects.size} subject(s) skipped because they clash, ${foreign.length} lock(s) held by another subject`);
  for (const k of foreign.slice(0, 10)) console.log(`  lock ${k.id} (${k.field}) currently points at ${have.get(k.id)}, wanted ${k.subjectId} - will be taken over`);
  if (!apply) continue;

  const byId = new Map(subjects.docs.map((d) => [d.id, d]));
  const backup = plan.subjectFixes.map((f) => ({ path: byId.get(f.id).ref.path, before: byId.get(f.id).data() }));
  if (backup.length) console.log(`  backup: ${writeBackup(`subject-keys-${college.id}`, backup)}`);
  let batch = db.batch(), n = 0;
  const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };
  for (const k of newKeys) { batch.set(college.collection("subjectKeys").doc(k.id), { subjectId: k.subjectId, field: k.field, updatedAt: new Date() }); if (++n >= 400) await flush(); }
  for (const f of plan.subjectFixes) { batch.update(byId.get(f.id).ref, f.set); if (++n >= 400) await flush(); }
  await flush();
  console.log("  done.");
}
