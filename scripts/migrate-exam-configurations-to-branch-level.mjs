/**
 * One-time migration: the Exam Cell's Internal Marks configuration moved
 * from per-subject (`examConfigurations/{subjectId}`) to per-(Course, Year)
 * — i.e. per branch, since a Course doc is already department-specific
 * (`examConfigurations/${courseId}_year${year}`). A single configuration now
 * applies to every subject taught under that course+year.
 *
 * This does two things, both idempotent and safe to re-run:
 *
 * 1. For every college, group its existing per-subject examConfigurations
 *    docs by (courseId, year). If a course+year has no branch-level doc yet,
 *    create one from the group's most-recently-updated subject config (the
 *    breakdown Exam Cell edited last). Old per-subject docs are NOT deleted
 *    (nothing is destroyed) - they simply stop being read once every reader
 *    resolves through the new courseId+year id instead. If more than one
 *    subject in the same course+year had a DIFFERENT breakdown configured,
 *    the ones not chosen are listed so nothing is silently dropped unnoticed.
 *
 * 2. Backfills `courseId`/`courseName` onto existing internalExamMarks
 *    batches that predate those fields, resolved from each batch's linked
 *    teachingAssignments doc - so already-submitted marks (Faculty/HOD/
 *    Principal all read the same batch) keep resolving to the right
 *    configuration after this change, with no code path needing to guess.
 *
 * Usage:
 *   node scripts/migrate-exam-configurations-to-branch-level.mjs           # dry run
 *   node scripts/migrate-exam-configurations-to-branch-level.mjs --apply   # write the fix
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const apply = process.argv.includes("--apply");

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

function examConfigId(courseId, year) {
  return `${courseId}_year${year}`;
}

async function migrateConfigurations(collegeRef, collegeLabel) {
  const configsSnap = await collegeRef.collection("examConfigurations").get();

  // Docs already at the new id scheme (id === `${courseId}_year${year}`) are
  // left completely alone - re-running this script must never touch them.
  const legacy = configsSnap.docs.filter((d) => {
    const data = d.data();
    return data.courseId && data.year != null && d.id !== examConfigId(data.courseId, data.year);
  });
  if (legacy.length === 0) return { created: 0, superseded: [] };

  const byCourseYear = new Map();
  for (const doc of legacy) {
    const data = doc.data();
    const key = examConfigId(data.courseId, data.year);
    if (!byCourseYear.has(key)) byCourseYear.set(key, []);
    byCourseYear.get(key).push({ doc, data });
  }

  let created = 0;
  const superseded = [];

  for (const [newId, group] of byCourseYear) {
    const targetRef = collegeRef.collection("examConfigurations").doc(newId);
    const targetSnap = await targetRef.get();
    if (targetSnap.exists) continue; // already migrated (or created fresh via the new UI) - never overwrite

    group.sort((a, b) => {
      const at = a.data.updatedAt?.toMillis?.() ?? 0;
      const bt = b.data.updatedAt?.toMillis?.() ?? 0;
      return bt - at; // most-recently-updated first
    });
    const winner = group[0];
    for (const other of group.slice(1)) {
      superseded.push({
        college: collegeLabel,
        courseYear: newId,
        keptSubject: `${winner.data.subjectName ?? winner.doc.id} (${winner.doc.id})`,
        droppedSubject: `${other.data.subjectName ?? other.doc.id} (${other.doc.id})`,
      });
    }

    const { subjectId, subjectName, subjectCode, ...rest } = winner.data;
    console.log(`  [examConfigurations] ${collegeLabel}: create ${newId} from ${winner.doc.id} (${subjectName ?? "?"})`);
    created += 1;
    if (apply) {
      await targetRef.set(rest);
    }
  }

  return { created, superseded };
}

async function backfillBatches(collegeRef, collegeLabel) {
  const [batchesSnap, assignmentsSnap] = await Promise.all([
    collegeRef.collection("internalExamMarks").get(),
    collegeRef.collection("teachingAssignments").get(),
  ]);
  const assignmentsById = new Map(assignmentsSnap.docs.map((d) => [d.id, d.data()]));

  const toFix = [];
  for (const doc of batchesSnap.docs) {
    const data = doc.data();
    if (data.courseId) continue; // already has it
    const assignment = assignmentsById.get(data.assignmentId);
    if (!assignment?.courseId) continue; // semester-scoped assignment - genuinely has no course+year, nothing to backfill
    toFix.push({ ref: doc.ref, id: doc.id, courseId: assignment.courseId, courseName: assignment.courseName ?? "", subjectName: data.subjectName });
  }
  if (toFix.length === 0) return 0;

  for (const f of toFix) {
    console.log(`  [internalExamMarks] ${collegeLabel}: backfill ${f.id} (${f.subjectName ?? "?"}) -> courseId=${f.courseId}`);
    if (apply) {
      await f.ref.update({ courseId: f.courseId, courseName: f.courseName });
    }
  }
  return toFix.length;
}

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  let totalConfigsCreated = 0;
  let totalBatchesFixed = 0;
  const allSuperseded = [];

  for (const collegeDoc of collegesSnap.docs) {
    const label = `${collegeDoc.id} (${collegeDoc.data().name ?? "?"})`;
    const { created, superseded } = await migrateConfigurations(collegeDoc.ref, label);
    totalConfigsCreated += created;
    allSuperseded.push(...superseded);
    totalBatchesFixed += await backfillBatches(collegeDoc.ref, label);
  }

  console.log(`\n${totalConfigsCreated} branch-level configuration(s) to create, ${totalBatchesFixed} batch(es) to backfill.`);
  if (allSuperseded.length > 0) {
    console.log(`\n${allSuperseded.length} subject-level configuration(s) were NOT chosen as the branch-level winner (not deleted, just no longer read):`);
    for (const s of allSuperseded) {
      console.log(`  - ${s.college} / ${s.courseYear}: kept ${s.keptSubject}, superseded ${s.droppedSubject}`);
    }
  }
  console.log(apply ? "\n✓ Applied." : "\nRe-run with --apply to write these changes.");
}

run().catch((err) => { console.error(err); process.exit(1); });
