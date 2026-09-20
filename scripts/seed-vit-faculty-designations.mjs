/**
 * Seeds VIT's FACULTY Designation Catalog (colleges/{id}/designations) from the
 * designations its faculty ALREADY hold, so the Add/Edit Faculty dropdowns,
 * CSV import, cadre-ratio report and delete/rename guards all resolve to the
 * exact same strings stored on facultyMembers.
 *
 * Why exact strings: facultyMembers.designation stores the catalog entry's
 * `name` verbatim (not an id). VIT's 258 imported faculty hold the legacy
 * codes ("ASSISTANT_PROFESSOR", ...), so the catalog entries are created with
 * exactly those names. The UI renders them as words through designationLabel();
 * the stored value never changes.
 *
 * WRITES ONLY to colleges/{VIT}/designations (adds). It never reads-then-writes
 * facultyMembers. Idempotent: an entry that already exists (exact name, or the
 * same designation under a different spelling) is left untouched and reported.
 *
 * Usage: node scripts/seed-vit-faculty-designations.mjs            (dry run)
 *        node scripts/seed-vit-faculty-designations.mjs --apply
 */
import "dotenv/config";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const VIT_COLLEGE_ID = "bc77d03b57194edeb006";
const VIT_COLLEGE_NAME = "VISHNU INSTITUTE OF TECHNOLOGY";

// Same cadre tags backfill-designation-catalog.mjs uses for engineering colleges,
// i.e. what faculty-requirement counted by literal code before the catalog
// existed. Codes not listed here (Professor of Practice, Visiting Professor,
// Sr. Wellness Counsellor) had no cadre before either and stay untagged.
const CADRE_BY_NAME = {
  PROFESSOR: "PROFESSOR",
  ASSOCIATE_PROFESSOR: "ASSOCIATE_PROFESSOR",
  ASSOCIATE_PROFESSOR_SR: "ASSOCIATE_PROFESSOR",
  ASSISTANT_PROFESSOR: "ASSISTANT_PROFESSOR",
  LECTURER: "ASSISTANT_PROFESSOR",
};

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
const loose = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function facultyCounts(collegeRef) {
  const snap = await collegeRef.collection("facultyMembers").get();
  const counts = {};
  for (const d of snap.docs) { const v = d.data().designation ?? "(none)"; counts[v] = (counts[v] ?? 0) + 1; }
  return { total: snap.size, counts };
}

async function main() {
  const collegeRef = db.collection("colleges").doc(VIT_COLLEGE_ID);
  const college = (await collegeRef.get()).data();
  if (college?.name !== VIT_COLLEGE_NAME) { console.error(`College mismatch: ${college?.name}`); process.exit(1); }

  const before = await facultyCounts(collegeRef);
  console.log(`VIT facultyMembers: ${before.total}`);

  const catSnap = await collegeRef.collection("designations").get();
  const existing = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`Existing catalog entries: ${existing.length}`);

  const now = new Date();
  const toAdd = [];
  for (const [name, count] of Object.entries(before.counts).sort((a, b) => b[1] - a[1])) {
    if (name === "(none)") continue;
    const clash = existing.find((c) => c.category === "FACULTY" && (c.name === name || loose(c.name) === loose(name)));
    if (clash) { console.log(`  = ${JSON.stringify(name)} (${count} faculty) already in catalog as ${JSON.stringify(clash.name)} - untouched`); continue; }
    const cadre = CADRE_BY_NAME[name];
    console.log(`  + ${JSON.stringify(name)} (${count} faculty)  category=FACULTY  cadre=${cadre ?? "-"}  isActive=true`);
    toAdd.push({ name, cadre });
  }

  if (!APPLY) { console.log(`\nDry run: would add ${toAdd.length} entr${toAdd.length === 1 ? "y" : "ies"}. Re-run with --apply to write.`); process.exit(0); }

  for (const a of toAdd) {
    await collegeRef.collection("designations").add({
      collegeId: VIT_COLLEGE_ID,
      name: a.name,
      category: "FACULTY",
      ...(a.cadre ? { cadre: a.cadre } : {}),
      isActive: true,
      createdBy: "system",
      createdByName: "System (seeded from existing VIT faculty)",
      createdAt: now,
      updatedAt: now,
    });
  }
  console.log(`\nAdded ${toAdd.length} entr${toAdd.length === 1 ? "y" : "ies"}.`);

  const after = await facultyCounts(collegeRef);
  const same = JSON.stringify(Object.entries(before.counts).sort()) === JSON.stringify(Object.entries(after.counts).sort()) && before.total === after.total;
  console.log(`facultyMembers designation counts unchanged: ${same ? "YES" : "NO !!"}`);
  process.exit(same ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
