/**
 * One-time data fix, scoped to VISHNU INSTITUTE OF TECHNOLOGY only
 * (COLLEGE_ID below).
 *
 * Every section's `batch` (Years 1-4) was previously left at a flat, wrong
 * default regardless of its course's duration and fixed year (from before the
 * Edit Section Batch picker derived it properly), and had no `regulation` set
 * at all (the field didn't exist yet). This recomputes each section's batch
 * from the college's current Academic Year (Settings > Academic Year, the
 * `academicSessions` doc with isCurrent:true) using the exact same derivation
 * the Edit Section page itself uses for a fixed year-slot -
 * deriveBatch(admissionStartYearForCourseYear(sessionStart, section.year),
 * course.durationYears) - see src/lib/college/academicSession.ts. For this
 * college's current session (2024-2025) and 4-year B.Tech that resolves to:
 * Year 1 -> 2024-2028, Year 2 -> 2023-2027, Year 3 -> 2022-2026,
 * Year 4 -> 2021-2025. It sets `regulation` to TARGET_REGULATION, but ONLY
 * where that regulation is actually one of the course's catalog regulations
 * and is offered for the section's own year (regulationBatches, resolved as
 * of the college's current session, falling back to the catalog's plain
 * `regulations` list for an entry that predates regulationBatches
 * entirely), mirroring the same check sections/[id]/route.ts PATCH applies
 * (src/lib/college/academicSession.ts's regulationsForCourseYearByBatch).
 * Anything that can't be safely resolved (missing course, no catalogId, regulation not
 * offered for that year) is reported and left untouched rather than guessed.
 *
 * This writes the exact same two fields (`batch`, `regulation`) that the Edit
 * Section form submits, using the same validation the PATCH route enforces -
 * equivalent in effect to opening every section in Edit Section and saving
 * it, without doing that by hand one section at a time.
 *
 * Dry-run by default - prints a report and writes nothing. Pass --apply to write.
 * Defaults to every year (1-4); pass --years=2,3,4 to scope to specific ones.
 * Defaults to VISHNU INSTITUTE OF TECHNOLOGY; pass --college=<key> for another
 * one in KNOWN_COLLEGES below (add a new entry there rather than editing
 * COLLEGE_ID directly, so the name-match warning still guards against a typo).
 *
 * Usage:
 *   node scripts/set-firstyear-batch-regulation.mjs
 *   node scripts/set-firstyear-batch-regulation.mjs --years=2,3,4
 *   node scripts/set-firstyear-batch-regulation.mjs --college=svecw --apply
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
const yearsArg = process.argv.find((a) => a.startsWith("--years="));
const TARGET_YEARS = yearsArg
  ? yearsArg.slice("--years=".length).split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 1)
  : [1, 2, 3, 4];
const collegeArg = process.argv.find((a) => a.startsWith("--college="));

// Known colleges this script has been run against so far - add new ones here
// rather than passing a raw id blind, so EXPECTED_NAME_MATCH can catch a typo.
const KNOWN_COLLEGES = {
  vit: { id: "bc77d03b57194edeb006", name: "VISHNU INSTITUTE OF TECHNOLOGY" },
  svecw: { id: "6df56a45a69244238ca0", name: "SHRI VISHNU ENGINEERING COLLEGE FOR WOMEN" },
};
const collegeKey = collegeArg ? collegeArg.slice("--college=".length) : "vit";
const college = KNOWN_COLLEGES[collegeKey];
// Every ask so far has been "btech" specifically - default to Bachelor of
// Technology only so an unrelated program (e.g. a 2-year MBA, whose batch
// span is naturally different) never gets swept in by accident. Pass
// --all-courses to lift this.
const ALL_COURSES = process.argv.includes("--all-courses");
const normalizeCode = (code) => (code ?? "").toUpperCase().replace(/[^A-Z]/g, "");
const isBtech = (c) => normalizeCode(c?.code) === "BTECH" || /bachelor'?s?\s+of\s+technology/i.test(c?.name ?? "");
if (!college) {
  console.log(`Unknown --college="${collegeKey}". Known: ${Object.keys(KNOWN_COLLEGES).join(", ")}`);
  process.exit(1);
}
const COLLEGE_ID = college.id;
const EXPECTED_NAME_MATCH = college.name;
const TARGET_REGULATION = "r23";

// --- mirrors src/lib/college/academicSession.ts ---
function parseAcademicYearStart(label) {
  const m = /^(\d{4})\s*-\s*(\d{2}|\d{4})$/.exec((label ?? "").trim());
  if (!m) return undefined;
  const start = Number(m[1]);
  return Number.isFinite(start) ? start : undefined;
}
function admissionStartYearForCourseYear(asOfStartYear, courseYear) {
  return asOfStartYear - courseYear + 1;
}
function deriveBatch(admissionStartYear, durationYears) {
  return `${admissionStartYear}-${admissionStartYear + durationYears}`;
}
function parseBatchStartYears(batch) {
  return String(batch ?? "")
    .split(",")
    .map((part) => { const m = part.trim().match(/^(\d{4})/); return m ? Number(m[1]) : null; })
    .filter((y) => y != null);
}
function regulationsForCourseYearByBatch(regulationBatches, courseYear, asOfStartYear, fallbackRegulations) {
  const entries = Object.entries(regulationBatches ?? {});
  if (entries.length === 0) {
    return Array.from(new Set((fallbackRegulations ?? []).map((r) => r.trim()).filter(Boolean)));
  }
  const matches = [];
  for (const [code, batch] of entries) {
    const hit = parseBatchStartYears(batch).some((start) => start === admissionStartYearForCourseYear(asOfStartYear, courseYear));
    if (hit) matches.push(code);
  }
  return matches;
}

async function run() {
  const collegeRef = db.collection("colleges").doc(COLLEGE_ID);
  const collegeSnap = await collegeRef.get();
  if (!collegeSnap.exists) {
    console.log(`College ${COLLEGE_ID} not found - aborting.`);
    process.exit(1);
  }
  const collegeName = collegeSnap.data().name ?? "?";
  console.log(`College: ${collegeName} (${COLLEGE_ID})`);
  if (collegeName.trim().toUpperCase() !== EXPECTED_NAME_MATCH) {
    console.log(`  WARNING: college name doesn't match expected "${EXPECTED_NAME_MATCH}" - double-check --college before using --apply.`);
  }

  const sessionsSnap = await collegeRef.collection("academicSessions").where("isCurrent", "==", true).get();
  if (sessionsSnap.size !== 1) {
    console.log(`  Found ${sessionsSnap.size} "isCurrent" academicSessions doc(s) under Settings > Academic Year - expected exactly 1. Aborting.`);
    process.exit(1);
  }
  const sessionLabel = sessionsSnap.docs[0].data().label;
  const sessionStart = parseAcademicYearStart(sessionLabel);
  if (sessionStart == null) {
    console.log(`  Current academic session label "${sessionLabel}" doesn't parse to a start year - aborting.`);
    process.exit(1);
  }
  console.log(`  Current Academic Year (Settings): ${sessionLabel} -> intake year ${sessionStart}`);
  console.log(`  Target years: ${TARGET_YEARS.join(", ")}\n`);

  const [sectionsSnap, coursesSnap, catalogSnap] = await Promise.all([
    collegeRef.collection("sections").where("year", "in", TARGET_YEARS).get(),
    collegeRef.collection("courses").get(),
    collegeRef.collection("courseCatalog").get(),
  ]);
  const coursesById = new Map(coursesSnap.docs.map((d) => [d.id, d.data()]));
  const catalogById = new Map(catalogSnap.docs.map((d) => [d.id, d.data()]));

  console.log(`  ${sectionsSnap.size} section(s) found across years ${TARGET_YEARS.join(", ")}.\n`);

  const batch = db.batch();
  let batchHasWrites = false;
  let willUpdate = 0, alreadyOk = 0, skipped = 0;

  for (const doc of sectionsSnap.docs) {
    const s = doc.data();
    const sectionYear = Number(s.year);
    const label = `Year ${sectionYear} - ${s.department ?? "?"} / ${s.name ?? doc.id} (course ${s.courseName ?? s.courseId ?? "?"})`;

    const course = s.courseId ? coursesById.get(s.courseId) : undefined;
    if (!course) {
      console.log(`  SKIP  ${label}: courseId "${s.courseId ?? ""}" not found`);
      skipped++;
      continue;
    }
    if (!ALL_COURSES && !isBtech(course)) {
      console.log(`  SKIP  ${label}: not Bachelor of Technology (pass --all-courses to include it)`);
      skipped++;
      continue;
    }
    const durationYears = Number(course.durationYears);
    if (!Number.isFinite(durationYears) || durationYears < 1) {
      console.log(`  SKIP  ${label}: course "${course.name}" has no valid durationYears`);
      skipped++;
      continue;
    }
    const admissionStartYear = admissionStartYearForCourseYear(sessionStart, sectionYear);
    const newBatch = deriveBatch(admissionStartYear, durationYears);

    let newRegulation = null;
    let regNote = "";
    if (!course.catalogId) {
      regNote = `course "${course.name}" has no catalogId - regulation left as-is (${s.regulation || "none"})`;
    } else {
      const catalogItem = catalogById.get(course.catalogId);
      if (!catalogItem) {
        regNote = `catalog entry ${course.catalogId} not found - regulation left as-is (${s.regulation || "none"})`;
      } else {
        const offered = regulationsForCourseYearByBatch(catalogItem.regulationBatches ?? {}, sectionYear, sessionStart, catalogItem.regulations);
        if (!offered.includes(TARGET_REGULATION)) {
          regNote = `"${TARGET_REGULATION}" not offered for Year ${sectionYear} of "${course.name}" (offered: ${offered.join(", ") || "none"}) - regulation left as-is (${s.regulation || "none"})`;
        } else {
          newRegulation = TARGET_REGULATION;
        }
      }
    }

    const batchChanging = s.batch !== newBatch;
    const regChanging = newRegulation != null && s.regulation !== newRegulation;
    if (!batchChanging && !regChanging) {
      console.log(`  OK    ${label}: already batch="${newBatch}"${newRegulation ? `, regulation="${newRegulation}"` : ""}`);
      alreadyOk++;
      continue;
    }

    console.log(
      `  ${APPLY ? "WRITE" : "PLAN "} ${label}: batch "${s.batch ?? ""}" -> "${newBatch}"` +
      (newRegulation ? `, regulation "${s.regulation || ""}" -> "${newRegulation}"` : "") +
      (regNote ? `  [${regNote}]` : "")
    );
    willUpdate++;

    if (APPLY) {
      const updates = { batch: newBatch, updatedAt: new Date() };
      if (newRegulation) updates.regulation = newRegulation;
      batch.update(doc.ref, updates);
      batchHasWrites = true;
    }
  }

  console.log(`\nTotals: toUpdate=${willUpdate}  alreadyOk=${alreadyOk}  skipped=${skipped}  total=${sectionsSnap.size}`);
  if (APPLY && batchHasWrites) {
    await batch.commit();
    console.log("Committed.");
  } else if (!APPLY) {
    console.log("\nDry run only - re-run with --apply to write these changes.");
  }
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
