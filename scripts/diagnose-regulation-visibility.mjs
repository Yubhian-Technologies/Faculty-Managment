/**
 * Read-only diagnostic, scoped to VISHNU INSTITUTE OF TECHNOLOGY.
 *
 * For every section that HAS a `regulation` stored, recomputes
 * regulationsForBatchStartYear(catalogItem.regulationBatches, batchStartYear,
 * catalogItem.regulations) against the section's OWN stored batch - exactly
 * as the Edit Section page's `regulationOptions` (and the sections
 * POST/PATCH server validation) now resolve it - and flags any section whose
 * own stored regulation is NOT in that freshly-computed list. The Edit
 * Section page has no fallback (unlike its Batch field, which explicitly
 * keeps an already-saved value visible even when it falls outside the
 * freshly derived candidate list) - a mismatch here means the field is
 * correctly saved in Firestore but the Select will silently render as
 * unset/placeholder, because none of its rendered SelectItems match the
 * stored value.
 *
 * Deliberately resolves from each section's own `batch` field, NOT from
 * "year + the college's current session" - a regulation is fixed to the
 * batch (admission cohort) it was written for, and that resolution doesn't
 * drift the way a session-pin-based one would (see
 * src/lib/college/academicSession.ts's regulationsForBatchStartYear, which
 * regulationsForCourseYearByBatch is now just a year+session convenience
 * wrapper around, for the few consumers - Subjects - that have no batch of
 * their own to resolve against).
 *
 * Usage: node scripts/diagnose-regulation-visibility.mjs
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
const COLLEGE_ID = "bc77d03b57194edeb006"; // VISHNU INSTITUTE OF TECHNOLOGY

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
  const collegeRef = db.collection("colleges").doc(COLLEGE_ID);
  const [sectionsSnap, coursesSnap, catalogSnap] = await Promise.all([
    collegeRef.collection("sections").get(),
    collegeRef.collection("courses").get(),
    collegeRef.collection("courseCatalog").get(),
  ]);
  const coursesById = new Map(coursesSnap.docs.map((d) => [d.id, d.data()]));
  const catalogById = new Map(catalogSnap.docs.map((d) => [d.id, d.data()]));

  let withRegulation = 0, withoutRegulation = 0, mismatched = 0, unparseableBatch = 0;
  for (const doc of sectionsSnap.docs) {
    const s = doc.data();
    if (!s.regulation) { withoutRegulation++; continue; }
    withRegulation++;
    const course = s.courseId ? coursesById.get(s.courseId) : undefined;
    const catalogItem = course?.catalogId ? catalogById.get(course.catalogId) : undefined;
    const batchStart = parseBatchStartYear(s.batch);
    if (batchStart == null) {
      unparseableBatch++;
      console.log(`  UNPARSEABLE-BATCH  Year ${s.year} - ${s.department} / ${s.name}: batch "${s.batch ?? ""}" has no leading 4-digit year - can't verify`);
      continue;
    }
    const offered = regulationsForBatchStartYear(catalogItem?.regulationBatches ?? {}, batchStart, catalogItem?.regulations);
    if (!offered.includes(s.regulation)) {
      mismatched++;
      console.log(`  MISMATCH  Year ${s.year} - ${s.department} / ${s.name}: batch "${s.batch}" -> stored regulation "${s.regulation}" NOT in currently-offered [${offered.join(", ")}] for course "${course?.name ?? s.courseId}"`);
    }
  }
  console.log(`\nTotals: withRegulation=${withRegulation}  withoutRegulation=${withoutRegulation}  mismatched(invisible-in-edit-dropdown)=${mismatched}  unparseableBatch=${unparseableBatch}`);
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
