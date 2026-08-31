/**
 * One-time data fix, scoped to VISHNU INSTITUTE OF TECHNOLOGY, Bachelor of
 * Technology sections only.
 *
 * Sets each section's `batch` and `regulation` from a fixed per-year mapping
 * (YEAR_CONFIG below), matching the college's real intake plan:
 *   Year 1 -> batch 2026-2030, regulation R26
 *   Year 2 -> batch 2025-2029, regulation R23
 *   Year 3 -> batch 2024-2028, regulation R23
 *   Year 4 -> batch 2023-2027, regulation R23
 *
 * Before writing either field, re-validates the target regulation is
 * actually offered for that section's year per the course's own Course
 * Catalog entry (regulationsForCourseYearByBatch, same resolution
 * sections/[id]/route.ts PATCH enforces) - a section that doesn't resolve
 * (catalog/session drift) is reported and left untouched rather than forced.
 * Regulation comparison/write is case-insensitive against the catalog's own
 * canonical code (mirrors the sections routes' own self-heal), so an
 * existing lowercase "r23" is corrected to "R23" in the same pass.
 *
 * Dry-run by default - prints a report and writes nothing. Pass --apply to write.
 *
 * Usage:
 *   node scripts/set-btech-year-batch-regulation.mjs
 *   node scripts/set-btech-year-batch-regulation.mjs --apply
 */

import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
const privateKey = rawKey.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
if (!getApps().length) {
  initializeApp({ credential: cert({ projectId: process.env.FIREBASE_ADMIN_PROJECT_ID, clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL, privateKey }) });
}
const db = getFirestore();
const APPLY = process.argv.includes("--apply");

const COLLEGE_ID = "bc77d03b57194edeb006"; // VISHNU INSTITUTE OF TECHNOLOGY
const EXPECTED_NAME_MATCH = "VISHNU INSTITUTE OF TECHNOLOGY";

const YEAR_CONFIG = {
  1: { batch: "2026-2030", regulation: "R26" },
  2: { batch: "2025-2029", regulation: "R23" },
  3: { batch: "2024-2028", regulation: "R23" },
  4: { batch: "2023-2027", regulation: "R23" },
};

const normalizeCode = (code) => (code ?? "").toUpperCase().replace(/[^A-Z]/g, "");
const isBtech = (c) => normalizeCode(c?.code) === "BTECH" || /bachelor'?s?\s+of\s+technology/i.test(c?.name ?? "");

// --- mirrors src/lib/college/academicSession.ts ---
function parseAcademicYearStart(label) {
  const m = /^(\d{4})\s*-\s*(\d{2}|\d{4})$/.exec((label ?? "").trim());
  return m && Number.isFinite(Number(m[1])) ? Number(m[1]) : undefined;
}
function currentAcademicStartYear() {
  const d = new Date();
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}
function admissionStartYearForCourseYear(asOfStartYear, courseYear) {
  return asOfStartYear - courseYear + 1;
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
  if (!collegeSnap.exists) { console.log(`College ${COLLEGE_ID} not found - aborting.`); process.exit(1); }
  const collegeName = collegeSnap.data().name ?? "?";
  console.log(`College: ${collegeName} (${COLLEGE_ID})`);
  if (collegeName.trim().toUpperCase() !== EXPECTED_NAME_MATCH) {
    console.log(`  WARNING: college name doesn't match expected "${EXPECTED_NAME_MATCH}" - double-check before using --apply.`);
  }

  const sessionsSnap = await collegeRef.collection("academicSessions").where("isCurrent", "==", true).limit(1).get();
  const asOfStartYear = sessionsSnap.empty
    ? currentAcademicStartYear()
    : parseAcademicYearStart(sessionsSnap.docs[0].data().label) ?? currentAcademicStartYear();
  console.log(`  Resolving "as of" intake year: ${asOfStartYear} (${sessionsSnap.empty ? "no isCurrent session doc, using clock" : `from isCurrent session "${sessionsSnap.docs[0].data().label}"`})\n`);

  const [sectionsSnap, coursesSnap, catalogSnap] = await Promise.all([
    collegeRef.collection("sections").where("year", "in", [1, 2, 3, 4]).get(),
    collegeRef.collection("courses").get(),
    collegeRef.collection("courseCatalog").get(),
  ]);
  const coursesById = new Map(coursesSnap.docs.map((d) => [d.id, d.data()]));
  const catalogById = new Map(catalogSnap.docs.map((d) => [d.id, d.data()]));

  console.log(`  ${sectionsSnap.size} section(s) found across years 1-4.\n`);

  const batch = db.batch();
  let batchHasWrites = false;
  let willUpdate = 0, alreadyOk = 0, skippedNotBtech = 0, skippedUnresolved = 0;

  for (const doc of sectionsSnap.docs) {
    const s = doc.data();
    const sectionYear = Number(s.year);
    const label = `Year ${sectionYear} - ${s.department ?? "?"} / ${s.name ?? doc.id} (course ${s.courseName ?? s.courseId ?? "?"})`;
    const config = YEAR_CONFIG[sectionYear];
    if (!config) continue;

    const course = s.courseId ? coursesById.get(s.courseId) : undefined;
    if (!course) { console.log(`  SKIP  ${label}: courseId "${s.courseId ?? ""}" not found`); skippedNotBtech++; continue; }
    if (!isBtech(course)) { skippedNotBtech++; continue; }

    if (!course.catalogId) {
      console.log(`  SKIP  ${label}: course "${course.name}" has no catalogId - can't verify regulation`);
      skippedUnresolved++;
      continue;
    }
    const catalogItem = catalogById.get(course.catalogId);
    if (!catalogItem) {
      console.log(`  SKIP  ${label}: catalog entry ${course.catalogId} not found`);
      skippedUnresolved++;
      continue;
    }
    const offered = regulationsForCourseYearByBatch(catalogItem.regulationBatches ?? {}, sectionYear, asOfStartYear, catalogItem.regulations);
    const canonical = offered.find((r) => r.toLowerCase() === config.regulation.toLowerCase());
    if (!canonical) {
      console.log(`  SKIP  ${label}: "${config.regulation}" not offered for Year ${sectionYear} as of intake ${asOfStartYear} (catalog offers: ${offered.join(", ") || "none"})`);
      skippedUnresolved++;
      continue;
    }

    const batchChanging = s.batch !== config.batch;
    const regChanging = s.regulation !== canonical;
    if (!batchChanging && !regChanging) {
      console.log(`  OK    ${label}: already batch="${config.batch}", regulation="${canonical}"`);
      alreadyOk++;
      continue;
    }

    console.log(
      `  ${APPLY ? "WRITE" : "PLAN "} ${label}: batch "${s.batch ?? ""}" -> "${config.batch}", regulation "${s.regulation || ""}" -> "${canonical}"`
    );
    willUpdate++;

    if (APPLY) {
      batch.update(doc.ref, { batch: config.batch, regulation: canonical, updatedAt: new Date() });
      batchHasWrites = true;
    }
  }

  console.log(`\nTotals: toUpdate=${willUpdate}  alreadyOk=${alreadyOk}  skippedNotBtech=${skippedNotBtech}  skippedUnresolved=${skippedUnresolved}  total=${sectionsSnap.size}`);
  if (APPLY && batchHasWrites) {
    await batch.commit();
    console.log("Committed.");
  } else if (!APPLY) {
    console.log("\nDry run only - re-run with --apply to write these changes.");
  }
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
