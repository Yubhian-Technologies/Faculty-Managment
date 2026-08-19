/**
 * One-time backfill: gives every already-PLACED student (has `section` set)
 * a `courseId` - the real reference to which Section doc they're actually
 * sitting in. Introduced because `department`+`section` (name)+`year` alone
 * can't disambiguate: a department can run a same-named section under more
 * than one course (college/sections POST's own duplicate check is scoped by
 * courseId for exactly this reason - e.g. a B.Tech "PHYSICS-IT-A" and a
 * later, independent M.Tech "PHYSICS-IT-A"), so without `courseId` a student
 * placed in one gets silently double-counted/misattributed into the other
 * (see StudentRecord.courseId's doc-comment in src/types/core.ts for the
 * full list of places this broke).
 *
 * For every placed student with no `courseId` yet, resolves candidate
 * sections by (department, name, year) - and, if that finds none, by
 * (secondaryDepartment, name, year), same fallback students/[id] route.ts's
 * findCurrentSectionDoc already uses for a shared-first-year student sitting
 * in their real branch's section:
 *
 *   - Exactly one match -> backfilled directly (--apply), no review needed.
 *   - Zero matches -> reported, left alone (an orphaned section reference -
 *     a separate, pre-existing data-quality question, not this bug).
 *   - 2+ matches -> genuinely ambiguous (the actual bug this migration
 *     exists for). Prints every candidate with its own courseName/createdAt,
 *     and proposes the one whose `createdAt` predates the student's own
 *     `updatedAt` as the likely original placement (a section created AFTER
 *     the student was already placed can't be the one they were actually put
 *     into) - but never auto-applies that guess. Pass --apply-ambiguous to
 *     actually write the proposed resolution for ambiguous cases too, after
 *     reviewing the dry-run report; plain --apply only writes the
 *     unambiguous ones.
 *
 * Dry-run by default - prints a report and writes nothing.
 *
 * Usage:
 *   node scripts/backfill-student-course-id.mjs
 *   node scripts/backfill-student-course-id.mjs --apply                (unambiguous only)
 *   node scripts/backfill-student-course-id.mjs --apply --apply-ambiguous   (+ proposed guesses)
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
const APPLY_AMBIGUOUS = process.argv.includes("--apply-ambiguous");
const toMillis = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : 0);

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  let totalUnambiguous = 0;
  let totalAmbiguous = 0;
  let totalOrphaned = 0;

  for (const college of collegesSnap.docs) {
    const collegeRef = college.ref;
    const [studentsSnap, sectionsSnap] = await Promise.all([
      collegeRef.collection("students").get(),
      collegeRef.collection("sections").get(),
    ]);

    const sections = sectionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const byDeptNameYear = new Map();
    for (const s of sections) {
      const key = `${(s.department ?? "").trim()}::${(s.name ?? "").trim().toUpperCase()}::${s.year ?? 0}`;
      const list = byDeptNameYear.get(key);
      if (list) list.push(s); else byDeptNameYear.set(key, [s]);
    }

    let printedHeader = false;
    const printHeader = () => {
      if (printedHeader) return;
      console.log(`\n=== College ${college.id} (${college.data().name ?? "?"}) ===`);
      printedHeader = true;
    };

    for (const d of studentsSnap.docs) {
      const s = d.data();
      if (!s.section || s.courseId) continue; // unassigned, or already backfilled

      const ownKey = `${(s.department ?? "").trim()}::${(s.section ?? "").trim().toUpperCase()}::${s.year ?? 0}`;
      let candidates = byDeptNameYear.get(ownKey) ?? [];
      if (candidates.length === 0 && s.secondaryDepartment) {
        const secKey = `${s.secondaryDepartment.trim()}::${(s.section ?? "").trim().toUpperCase()}::${s.year ?? 0}`;
        candidates = byDeptNameYear.get(secKey) ?? [];
      }

      if (candidates.length === 0) {
        totalOrphaned++;
        printHeader();
        console.log(`  ORPHANED: "${s.name}" (id=${d.id}) dept=${s.department} section=${s.section} year=${s.year} - no matching Section doc at all, left alone`);
        continue;
      }

      if (candidates.length === 1) {
        totalUnambiguous++;
        const c = candidates[0];
        printHeader();
        console.log(`  "${s.name}" (id=${d.id}): courseId -> ${c.courseId} (${c.courseName ?? c.courseId}) [via section ${c.id}]`);
        if (APPLY) {
          await d.ref.update({ courseId: c.courseId, course: c.courseName ?? null, updatedAt: new Date() });
        }
        continue;
      }

      // Ambiguous: 2+ sections share (department[or secondaryDepartment],
      // name, year). Propose whichever was created before the student's own
      // last write (their most recent placement) as the likely original -
      // a section created afterward can't be the one they were put into.
      totalAmbiguous++;
      const studentUpdatedAt = toMillis(s.updatedAt) || toMillis(s.createdAt);
      const eligible = candidates.filter((c) => toMillis(c.createdAt) <= studentUpdatedAt || studentUpdatedAt === 0);
      const proposal = eligible.length > 0
        ? eligible.reduce((a, b) => (toMillis(a.createdAt) > toMillis(b.createdAt) ? a : b))
        : null;
      printHeader();
      console.log(`  AMBIGUOUS: "${s.name}" (id=${d.id}) dept=${s.department} section=${s.section} year=${s.year} - ${candidates.length} matching sections:`);
      for (const c of candidates) {
        const mark = proposal && c.id === proposal.id ? " <- proposed" : "";
        console.log(`      section=${c.id} courseId=${c.courseId} (${c.courseName ?? c.courseId}, section createdAt=${new Date(toMillis(c.createdAt)).toISOString()})${mark}`);
      }
      if (APPLY && APPLY_AMBIGUOUS && proposal) {
        await d.ref.update({ courseId: proposal.courseId, course: proposal.courseName ?? null, updatedAt: new Date() });
      }
    }
  }

  console.log(
    `\n${APPLY ? "Backfilled" : "Would backfill"} ${totalUnambiguous} unambiguous student(s). ` +
    `${totalAmbiguous} ambiguous case(s) found${APPLY && APPLY_AMBIGUOUS ? " and resolved via proposed guess" : " (not applied - re-run with --apply --apply-ambiguous after reviewing)"}. ` +
    `${totalOrphaned} orphaned reference(s) left alone.`
  );
  if (!APPLY) {
    console.log("\nDry run only - re-run with --apply to write the unambiguous cases.");
  }
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
