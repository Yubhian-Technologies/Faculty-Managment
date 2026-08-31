/**
 * One-time data fix, Bachelor of Technology sections only, for a college
 * from KNOWN_COLLEGES below.
 *
 * Sets each section's `batch` and `regulation` from a fixed per-year mapping
 * (YEAR_CONFIG below), matching the college's real intake plan:
 *   Year 1 -> batch 2026-2030, regulation R26
 *   Year 2 -> batch 2025-2029, regulation R23
 *   Year 3 -> batch 2024-2028, regulation R23
 *   Year 4 -> batch 2023-2027, regulation R23
 *
 * Before writing either field, re-validates the target regulation is
 * actually offered for that TARGET batch's own admission year per the
 * course's own Course Catalog entry (regulationsForBatchStartYear - the same
 * batch-driven resolution the Add/Edit Section pickers and the sections
 * POST/PATCH routes use, not year+session) - a section whose catalog entry
 * doesn't actually offer that regulation for that batch is reported and left
 * untouched rather than forced, so this only ever applies what the Dean has
 * genuinely configured in Course Catalog. Regulation comparison/write is
 * case-insensitive against the catalog's own canonical code (mirrors the
 * sections routes' own self-heal), so an existing lowercase "r23" is
 * corrected to "R23" in the same pass.
 *
 * Dry-run by default - prints a report and writes nothing. Pass --apply to write.
 *
 * Usage:
 *   node scripts/set-btech-year-batch-regulation.mjs --college=vit
 *   node scripts/set-btech-year-batch-regulation.mjs --college=svecw --apply
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

const KNOWN_COLLEGES = {
  vit: { id: "bc77d03b57194edeb006", name: "VISHNU INSTITUTE OF TECHNOLOGY" },
  svecw: { id: "6df56a45a69244238ca0", name: "SHRI VISHNU ENGINEERING COLLEGE FOR WOMEN" },
};
const collegeArg = process.argv.find((a) => a.startsWith("--college="));
const collegeKey = collegeArg ? collegeArg.slice("--college=".length) : null;
const college = collegeKey ? KNOWN_COLLEGES[collegeKey] : null;
if (!college) {
  console.log(`Usage: node scripts/set-btech-year-batch-regulation.mjs --college=<${Object.keys(KNOWN_COLLEGES).join("|")}> [--apply]`);
  process.exit(1);
}

const YEAR_CONFIG = {
  1: { batch: "2026-2030", regulation: "R26" },
  2: { batch: "2025-2029", regulation: "R23" },
  3: { batch: "2024-2028", regulation: "R23" },
  4: { batch: "2023-2027", regulation: "R23" },
};

const normalizeCode = (code) => (code ?? "").toUpperCase().replace(/[^A-Z]/g, "");
const isBtech = (c) => normalizeCode(c?.code) === "BTECH" || /bachelor'?s?\s+of\s+technology/i.test(c?.name ?? "");

// --- mirrors src/lib/college/academicSession.ts ---
function parseBatchStartYear(batch) {
  const m = String(batch ?? "").trim().match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}
function parseBatchStartYears(batch) {
  return String(batch ?? "")
    .split(",")
    .map((part) => parseBatchStartYear(part))
    .filter((y) => y != null);
}
function regulationsForBatchStartYear(regulationBatches, batchStartYear, fallbackRegulations) {
  const entries = Object.entries(regulationBatches ?? {});
  if (entries.length === 0) {
    return Array.from(new Set((fallbackRegulations ?? []).map((r) => r.trim()).filter(Boolean)));
  }
  const matches = [];
  for (const [code, batch] of entries) {
    if (parseBatchStartYears(batch).includes(batchStartYear)) matches.push(code);
  }
  return matches;
}

async function run() {
  const collegeRef = db.collection("colleges").doc(college.id);
  const collegeSnap = await collegeRef.get();
  if (!collegeSnap.exists) { console.log(`College ${college.id} not found - aborting.`); process.exit(1); }
  const collegeName = collegeSnap.data().name ?? "?";
  console.log(`College: ${collegeName} (${college.id})`);
  if (collegeName.trim().toUpperCase() !== college.name) {
    console.log(`  WARNING: college name doesn't match expected "${college.name}" - double-check before using --apply.`);
  }

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
    const targetBatchStart = parseBatchStartYear(config.batch);
    const offered = regulationsForBatchStartYear(catalogItem.regulationBatches ?? {}, targetBatchStart, catalogItem.regulations);
    const canonical = offered.find((r) => r.toLowerCase() === config.regulation.toLowerCase());
    if (!canonical) {
      console.log(`  SKIP  ${label}: "${config.regulation}" not offered for batch ${config.batch} per Course Catalog (offers: ${offered.join(", ") || "none"})`);
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
