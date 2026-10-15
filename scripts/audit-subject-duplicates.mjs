/**
 * READ-ONLY REPORT. Lists, per college, every master subject that breaks the identity rule
 *   inside one Course Catalog course + regulation: Subject Code and Subject Name are each unique.
 * Run it BEFORE scripts/backfill-subject-keys.mjs. A clash is never fixed automatically: the Office decides, per
 * group, which subject keeps the code/name (the other is renamed to a new code, merged, or removed) - this report
 * says how many semester assignments and teaching assignments hang off each member to make that call easy.
 *
 * It also lists subjects it cannot key (no regulation, unknown course) and counts the legacy semester-scoped ones.
 * Writes nothing to Firestore. Writes one CSV per college into the repo-root backups/ folder (git-ignored).
 *
 * Usage:
 *   node scripts/audit-subject-duplicates.mjs                  -> every college
 *   node scripts/audit-subject-duplicates.mjs --college=<id>   -> one college (VIT or VWU)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { init, parseArgs } from "./lib/scriptKit.mjs";
import { planSubjectKeys } from "./lib/subjectKeysCore.mjs";

const { opt } = parseArgs();
const { db } = init();
console.log("READ-ONLY subject identity audit (nothing is written to the database)\n");

const csv = (cells) => cells.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",");
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "backups");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const only = opt("college");
const colleges = only ? [db.collection("colleges").doc(only)] : (await db.collection("colleges").get()).docs.map((d) => d.ref);
let totalClashes = 0;
for (const college of colleges) {
  const name = (await college.get()).data()?.name ?? college.id;
  const [subjects, courses, instances, tas] = await Promise.all([
    college.collection("subjects").get(),
    college.collection("courses").select("catalogId").get(),
    college.collection("subjectSemesterAssignments").select("subjectId").get(),
    college.collection("teachingAssignments").select("subjectId").get(),
  ]);
  const usage = new Map();
  for (const d of [...instances.docs, ...tas.docs]) {
    const id = d.get("subjectId");
    if (id) usage.set(id, (usage.get(id) ?? 0) + 1);
  }
  const plan = planSubjectKeys(
    subjects.docs.map((d) => ({ id: d.id, data: d.data() })),
    courses.docs.map((d) => ({ id: d.id, data: d.data() })),
    usage,
  );
  console.log(`${name}: ${subjects.size} subjects - ${plan.clashes.length} clash group(s), ${plan.unscoped.length} unkeyable, ${plan.legacy.length} legacy semester-scoped`);
  totalClashes += plan.clashes.length;

  const rows = [["College", "Clash on", "Value", "Catalog course", "Regulation", "Subject id", "Code", "Name", "Active", "Used by (assignments + teaching)"]];
  for (const c of plan.clashes) {
    for (const m of c.members) rows.push([name, c.field, c.value, c.scope, c.regulation, m.id, m.rawCode, m.name, m.isActive ? "yes" : "no", m.used]);
  }
  for (const u of plan.unscoped) rows.push([name, `cannot key: ${u.reason}`, "", "", "", u.id, u.code, "", "", ""]);
  if (rows.length > 1) {
    const file = join(outDir, `subject-duplicates-${name.replace(/[^A-Za-z0-9]+/g, "_")}-${stamp}.csv`);
    writeFileSync(file, "﻿" + rows.map(csv).join("\r\n"));
    console.log(`  -> ${file}`);
  }
}
console.log(totalClashes === 0 ? "\nNo clashes: scripts/backfill-subject-keys.mjs can be run." : `\n${totalClashes} clash group(s). Resolve them (rename a subject to a new code, or remove the extra one) and run this report again before backfilling.`);
