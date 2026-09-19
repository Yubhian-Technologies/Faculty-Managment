/**
 * READ-ONLY diagnostic: compares the designations actually stored on VIT's
 * faculty records against VIT's Designation Catalog (colleges/{id}/designations).
 * Never writes.
 *
 * Reports:
 *   - every distinct facultyMembers.designation value (exact string, JSON-quoted so
 *     stray whitespace is visible) with its count, split by status
 *   - every catalog entry (id, name, category, cadre, isActive)
 *   - which faculty designations have an EXACT match in the FACULTY catalog, which only
 *     match loosely (case/whitespace/punctuation), which match an entry in another
 *     category or an inactive entry, and which have no entry at all
 *   - distinct supportingStaff.designation values, for cross-category clash checks
 *
 * Usage: node scripts/diagnose-vit-designations.mjs
 */
import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const VIT_COLLEGE_ID = "bc77d03b57194edeb006";
const VIT_COLLEGE_NAME = "VISHNU INSTITUTE OF TECHNOLOGY";

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

// Same loose key the import route's matchOption uses conceptually: case/punctuation/spacing-insensitive.
const loose = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const q = (s) => JSON.stringify(s);

async function main() {
  const collegeRef = db.collection("colleges").doc(VIT_COLLEGE_ID);
  const collegeSnap = await collegeRef.get();
  const college = collegeSnap.data();
  console.log(`College: ${college?.name} (type: ${college?.type}) [${VIT_COLLEGE_ID}]`);
  if (college?.name !== VIT_COLLEGE_NAME) {
    console.error("!! College name mismatch - aborting."); process.exit(1);
  }

  // ── faculty ──
  const facSnap = await collegeRef.collection("facultyMembers").get();
  console.log(`\nfacultyMembers docs: ${facSnap.size}`);
  const byDesig = new Map();
  let missing = 0, nonString = 0;
  for (const d of facSnap.docs) {
    const x = d.data();
    const v = x.designation;
    if (v === undefined || v === null || v === "") { missing++; continue; }
    if (typeof v !== "string") { nonString++; }
    const key = typeof v === "string" ? v : `[non-string ${typeof v}] ${JSON.stringify(v)}`;
    const e = byDesig.get(key) ?? { count: 0, statuses: {}, depts: new Set(), ids: [] };
    e.count++;
    e.statuses[x.status ?? "(none)"] = (e.statuses[x.status ?? "(none)"] ?? 0) + 1;
    if (x.department) e.depts.add(x.department);
    e.ids.push(d.id);
    byDesig.set(key, e);
  }
  console.log(`  with no designation: ${missing}; non-string designation: ${nonString}`);
  console.log(`\nDistinct faculty designations (${byDesig.size}):`);
  for (const [k, e] of [...byDesig.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${String(e.count).padStart(4)}  ${q(k)}   status=${JSON.stringify(e.statuses)}`);
  }

  // ── catalog ──
  const catSnap = await collegeRef.collection("designations").get();
  const catalog = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`\nCatalog entries (colleges/${VIT_COLLEGE_ID}/designations): ${catalog.length}`);
  for (const c of catalog.sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name))) {
    console.log(`  [${c.category}] ${q(c.name)}  cadre=${c.cadre ?? "-"}  isActive=${c.isActive}  id=${c.id}  createdBy=${c.createdByName ?? c.createdBy ?? "-"}`);
  }

  // Duplicate check inside the catalog
  const seen = new Map();
  for (const c of catalog) {
    const k = `${c.category}|${loose(c.name)}`;
    (seen.get(k) ?? seen.set(k, []).get(k)).push(c.name);
  }
  const dups = [...seen.entries()].filter(([, v]) => v.length > 1);
  console.log(`\nLoose duplicates inside catalog: ${dups.length ? JSON.stringify(dups) : "none"}`);

  // ── compare ──
  console.log("\nFaculty designation -> catalog resolution:");
  const facultyCat = catalog.filter((c) => c.category === "FACULTY");
  for (const [k, e] of [...byDesig.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const exact = facultyCat.find((c) => c.name === k);
    const looseHit = facultyCat.filter((c) => loose(c.name) === loose(k));
    const other = catalog.filter((c) => c.category !== "FACULTY" && loose(c.name) === loose(k));
    let verdict;
    if (exact) verdict = exact.isActive ? "EXACT match, active (OK)" : "EXACT match but INACTIVE";
    else if (looseHit.length) verdict = `LOOSE match only -> ${looseHit.map((c) => q(c.name)).join(", ")}`;
    else if (other.length) verdict = `only in other category: ${other.map((c) => `${c.category}:${q(c.name)}`).join(", ")}`;
    else verdict = "MISSING from catalog";
    console.log(`  ${String(e.count).padStart(4)}  ${q(k)}  =>  ${verdict}`);
  }
  const facKeys = new Set(byDesig.keys());
  const unused = facultyCat.filter((c) => !facKeys.has(c.name));
  console.log(`\nFACULTY catalog entries used by no faculty (${unused.length}): ${unused.map((c) => q(c.name)).join(", ") || "none"}`);

  // ── supporting staff (context only) ──
  const ssSnap = await collegeRef.collection("supportingStaff").get();
  const ss = new Map();
  for (const d of ssSnap.docs) { const v = d.data().designation ?? "(none)"; ss.set(v, (ss.get(v) ?? 0) + 1); }
  console.log(`\nsupportingStaff docs: ${ssSnap.size}; distinct designations: ${ss.size}`);
  for (const [k, n] of [...ss.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${q(k)}`);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
