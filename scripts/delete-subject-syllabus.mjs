// Deletes the syllabus (units, COs, CO -> PO / PSO mapping, its change history and status) of the subjects one
// Subject Department looks after in one college - the whole colleges/<c>/subjectSyllabus/<subjectId> document, so
// nothing of it (not even its history) is left - plus their older per-branch colleges/<c>/subjectOutcomes docs.
// The subject itself, its syllabus PDF, banks / papers and questions are NOT touched.
//
// Refuses a subject whose syllabus a started question bank / paper set already uses (outcomesId), unless --force.
//
//   node --env-file=.env.local scripts/delete-subject-syllabus.mjs --college="VISHNU INSTITUTE" --department="CHEMISTRY"        # dry run
//   node --env-file=.env.local scripts/delete-subject-syllabus.mjs --college="VISHNU INSTITUTE" --department="CHEMISTRY" --apply # backup, then delete
import { init, parseArgs, writeBackup, banner } from "./lib/scriptKit.mjs";

const { apply, opt, flag } = parseArgs();
const collegeQ = (opt("college") ?? "").toUpperCase();
const deptQ = (opt("department") ?? "").toUpperCase();
const onlySubject = opt("subject");   // optional: one subject code
if (!collegeQ || !deptQ) { console.error('Give --college="..." and --department="..." (part of the name)'); process.exit(1); }
const { db } = init();
banner(apply);

const colleges = (await db.collection("colleges").get()).docs.filter((d) => String(d.get("name") ?? "").toUpperCase().includes(collegeQ));
if (colleges.length !== 1) { console.error(`College "${collegeQ}" matched ${colleges.length}: ${colleges.map((d) => `${d.get("name")} (${d.id})`).join(", ")}`); process.exit(1); }
const college = colleges[0];
console.log(`College: ${college.get("name")} (${college.id})`);
const col = (n) => college.ref.collection(n);

const depts = (await col("departments").get()).docs.filter((d) => String(d.get("name") ?? "").toUpperCase().includes(deptQ));
console.log(`Departments matching "${deptQ}": ${depts.map((d) => `${d.get("name")} (${d.id})`).join(", ") || "none"}`);
if (depts.length !== 1) { console.error("Need exactly one department - be more specific."); process.exit(1); }
const dept = depts[0];

// Subjects the department looks after (Subject Department), new list or the older single field.
const subjects = (await col("subjects").get()).docs.filter((d) => {
  const x = d.data();
  const ids = [...(x.ownerDepartmentIds ?? []), ...(x.ownerDepartments ?? []).map((o) => o.id), x.ownerDepartmentId].filter(Boolean);
  return ids.includes(dept.id) && (!onlySubject || String(x.code).toUpperCase() === onlySubject.toUpperCase());
});
console.log(`Subjects of ${dept.get("name")}: ${subjects.length}\n`);

const [sylSnap, outSnap, bankSnap] = await Promise.all([col("subjectSyllabus").get(), col("subjectOutcomes").get(), col("midQuestionBanks").get()]);
const toDelete = [];
const blocked = [];
for (const s of subjects) {
  const x = s.data();
  const syl = sylSnap.docs.find((d) => d.id === s.id);
  const outs = outSnap.docs.filter((d) => d.get("subjectId") === s.id || d.id.startsWith(`${s.id}__`));
  const using = bankSnap.docs.filter((b) => b.get("outcomesId") === `syllabus__${s.id}` || outs.some((o) => o.id === b.get("outcomesId")));
  const sy = syl?.data();
  console.log(`${x.code} ${x.name} [${x.regulation ?? ""}]`);
  console.log(`  syllabus: ${sy ? `${sy.status}, ${sy.units?.length ?? 0} units, ${sy.cos?.length ?? 0} COs, ${Object.keys(sy.mapping ?? {}).length} mapped, ${sy.history?.length ?? 0} history entries` : "none"}`);
  if (outs.length) console.log(`  older per-branch outcomes: ${outs.map((o) => o.id).join(", ")}`);
  if (using.length) console.log(`  USED BY ${using.length} bank / paper set(s): ${using.map((b) => `${b.get("ownerName")} (${b.get("branch")}, Mid ${b.get("midNumber")}, ${b.get("approval") ?? b.get("status")})`).join("; ")}`);
  if (!sy && !outs.length) continue;
  if (using.length && !flag("force")) { blocked.push(x.code); continue; }
  if (syl) toDelete.push(syl);
  toDelete.push(...outs);
}
console.log(`\nWould delete ${toDelete.length} document(s)${blocked.length ? `; skipped (in use - add --force to delete anyway): ${blocked.join(", ")}` : ""}.`);
if (!apply || !toDelete.length) process.exit(0);

const file = writeBackup(`syllabus-${college.id}-${dept.id}`, toDelete.map((d) => ({ path: d.ref.path, data: d.data() })));
console.log(`Backup: ${file}`);
const batch = db.batch();
for (const d of toDelete) batch.delete(d.ref);
await batch.commit();
console.log(`Deleted ${toDelete.length} document(s).`);
