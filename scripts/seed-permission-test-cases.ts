/**
 * Seeds the Student Permission module with manual-test scenarios in ONE college + department, by calling the
 * module's own service (so every record has the real shape, on-duty coverage and notifications).
 *
 *   npx tsx --env-file=.env scripts/seed-permission-test-cases.ts            -> DRY RUN, prints the plan
 *   npx tsx --env-file=.env scripts/seed-permission-test-cases.ts --apply    -> writes
 *
 * Everything it creates has a title starting "[TEST] ". It refuses to run twice (it stops if any "[TEST] " request
 * exists) and writes backups/seed-permission-test-cases-<time>.json listing every id it created.
 * Defaults: Yubhian Engineering College (a TEST-category college) / Computer Science & Engineering.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { getAdminDb, getAdminStorage } from "../src/lib/firebase/admin";
import { istDateKey } from "../src/lib/attendance/istTime";
import { getClassDays } from "../src/lib/studentAttendance/classDay";
import * as svc from "../src/lib/studentPermissions/service";
import type { ActingUser } from "../src/lib/studentPermissions/types";

const COLLEGE = "6657e7f7107d44fe87ea"; // Yubhian Engineering College
const DEPT = "Computer Science & Engineering";
const apply = process.argv.includes("--apply");
const T = "[TEST] ";

const db = getAdminDb();
const college = db.collection("colleges").doc(COLLEGE);
const as = (uid: string, name: string, roles: string[]): ActingUser => ({ uid, name, collegeId: COLLEGE, roles });

// Real logins in the college (looked up, not invented).
const deepika = as("YGAJvK8VqNb22f1UoawBE7q98eE2", "A. Deepika", ["STUDENT"]); // CSE-A y2, lab batch B2
const bhargav = as("yuo3hgvdQLZyjHaG2O9iQDDpQXY2", "A. Bhargav", ["STUDENT"]); // CSE-A y2
const venkata = as("VSXKxqBEIhdtIaKmSkjYldhErcJ2", "B. Venkata", ["STUDENT"]); // CSE-A y3
const manasa = as("NlPJuayQkMUeprm4wFgYu7HpPPr2", "A. Manasa", ["STUDENT"]); // CSE-A y3
const incharge = as("s8rTt0vPxDeSR67U51LFZ6erC8m1", "Dr. Arjun Prakash", ["PANEL_MEMBER"]); // incharge of CSE-A y2 and y3
const hod = as("esQh1QPDVdhxBWx7daOArVA8I8k1", "DORA BABU", ["PANEL_MEMBER", "HOD"]); // HOD of CSE
const SECTION_CSE_A_Y2 = "uI9kmSz3D8gETP3uva2d";

const created: { id: string; scenario: string }[] = [];
const note = (scenario: string, r: { id: string }) => { created.push({ id: r.id, scenario }); console.log(`  ${r.id}  ${scenario}`); };

async function main() {
  const existing = await college.collection("approvalRequests").where("kind", "==", "STUDENT_PERMISSION").get();
  if (existing.docs.some((d) => String(d.get("payload.title") ?? "").startsWith(T))) {
    console.error("A \"[TEST] \" request already exists - not seeding twice."); process.exit(1);
  }

  const today = istDateKey();
  const horizon = new Date(Date.now() + 21 * 86_400_000);
  const days = await getClassDays(db, COLLEGE, today, istDateKey(horizon)); // class days only (no Sundays / holidays)
  if (days.length < 8) throw new Error(`Only ${days.length} class days ahead - cannot place the scenarios`);
  const [d0, d1, d2, d3, d4, d5, d6, d7] = days;
  const sec = (await college.collection("sections").doc(SECTION_CSE_A_Y2).get()).data() as { name: string; classRepresentatives?: unknown[] };
  const roster = (await college.collection("students").where("department", "==", DEPT).where("section", "==", sec.name).where("year", "==", 2).get()).docs
    .filter((d) => d.get("status") === "REGULAR" && !d.get("uid")).slice(0, 5).map((d) => d.id);
  const deepikaId = (await college.collection("students").where("uid", "==", deepika.uid).limit(1).get()).docs[0].id;

  console.log(`College ${COLLEGE} / ${DEPT}  (${apply ? "APPLY" : "DRY RUN"})`);
  console.log(`Class days used: ${[d0, d1, d2, d3, d4, d5, d6, d7].join(", ")}`);
  console.log("Plan:\n  1 pending at Class Incharge | 2 approved ALL periods today (late-flagged, On Duty in attendance) | 3 approved periods 1-3 on a later day"
    + "\n  4 rejected by HOD | 5 withdrawn | 6 revoked after approval | 7 faculty-raised group pending at HOD | 8 HOD-raised group pending at Principal"
    + `\n  + a proof file in Storage, and A. Deepika set as Class Representative of ${sec.name} y2 (Section Feed test)`);
  if (!apply) { console.log("\nDry run - nothing written. Add --apply."); return; }

  // A small real PDF so proof links are valid, viewable uploads from this college.
  const bucket = getAdminStorage().bucket();
  const proofPath = `student-permission-proofs/${COLLEGE}/${incharge.uid}/${randomUUID()}.pdf`;
  const token = randomUUID();
  const pdf = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
  await bucket.file(proofPath).save(pdf, { resumable: false, metadata: { contentType: "application/pdf", metadata: { firebaseStorageDownloadTokens: token } } });
  const proof = [{ url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(proofPath)}?alt=media&token=${token}`, name: "test-invitation.pdf" }];

  const event = (title: string, from: string, to: string, extra: object = {}) => ({
    categoryId: "dept-events.workshops", title: T + title, description: "Seeded manual-test request.", fromDate: from, toDate: to, periods: "ALL", proof: [], ...extra,
  });
  const hack = (title: string, from: string, to: string, studentIds: string[]) => ({
    categoryId: "external-participation.hackathons", title: T + title, description: "Seeded manual-test request.", fromDate: from, toDate: to, periods: "ALL", proof, studentIds,
  });
  const go = async (scenario: string, p: Promise<{ id: string }>) => { const r = await p; note(scenario, r); return r; };

  console.log("\nCreating:");
  // 1. Waiting for the class incharge (route: Class Incharge -> HOD).
  await go("1 PENDING at Class Incharge (A. Deepika, class day #8, clear of her older requests)", svc.createStudentRequest(db, deepika, event("Pending - class incharge", d7, d7)));

  // 2. Approved, covers today entirely: the student shows On Duty when attendance is taken today.
  const r2 = await go("2 APPROVED all periods TODAY (A. Bhargav) - On Duty in attendance", svc.createStudentRequest(db, bhargav, event("Approved - today all periods", d0, d0)));
  await svc.decide(db, incharge, r2.id, "APPROVE", "Seed: incharge OK");
  await svc.decide(db, hod, r2.id, "APPROVE", "Seed: HOD OK");

  // 3. Approved for only periods 1-3 on a later day (period-specific On Duty).
  const r3 = await go("3 APPROVED periods 1-3 only (B. Venkata, class day #2)", svc.createStudentRequest(db, venkata, event("Approved - periods 1 to 3", d1, d1, { periods: [1, 2, 3] })));
  await svc.decide(db, incharge, r3.id, "APPROVE"); await svc.decide(db, hod, r3.id, "APPROVE");

  // 4. Rejected by the HOD after the incharge approved.
  const r4 = await go("4 REJECTED by HOD with a reason (A. Manasa)", svc.createStudentRequest(db, manasa, event("Rejected by HOD", d3, d3)));
  await svc.decide(db, incharge, r4.id, "APPROVE"); await svc.decide(db, hod, r4.id, "REJECT", "Seed: clashes with a mid exam");

  // 5. Withdrawn by the student.
  const r5 = await go("5 CANCELLED by the student (B. Venkata)", svc.createStudentRequest(db, venkata, event("Withdrawn by student", d4, d4)));
  await svc.cancelRequest(db, venkata, r5.id, "Seed: plans changed");

  // 6. Approved, then revoked (attendance restored).
  const r6 = await go("6 REVOKED after approval (A. Manasa)", svc.createStudentRequest(db, manasa, event("Revoked after approval", d5, d5)));
  await svc.decide(db, incharge, r6.id, "APPROVE"); await svc.decide(db, hod, r6.id, "APPROVE");
  await svc.revokeRequest(db, hod, r6.id, "Seed: event cancelled by organisers");

  // 7. Faculty raises for a group (with proof) - waits at the HOD.
  const g7 = await svc.createFacultyRequests(db, incharge, hack("Faculty group - pending at HOD", d6, d6, roster.slice(0, 3)));
  g7.forEach((r) => note("7 PENDING at HOD - raised by faculty for 3 students", r));

  // 8. The HOD raises one - the HOD stage is skipped, so it waits at the Principal.
  const g8 = await svc.createFacultyRequests(db, hod, hack("HOD group - pending at Principal", d7, d7, roster.slice(3, 5)));
  g8.forEach((r) => note("8 PENDING at Principal - raised by the HOD for 2 students", r));

  // Class Representative, so the student Section Feed tab can be checked (reversible: clear classRepresentatives).
  await college.collection("sections").doc(SECTION_CSE_A_Y2).update({ classRepresentatives: [{ studentId: deepikaId, name: deepika.name, rollNumber: "" }] });
  console.log("  A. Deepika set as Class Representative of CSE-A y2");

  mkdirSync("backups", { recursive: true });
  const file = `backups/seed-permission-test-cases-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify({ college: COLLEGE, department: DEPT, proofPath, classRepresentativeSection: SECTION_CSE_A_Y2, previousClassRepresentatives: sec.classRepresentatives ?? [], created }, null, 2));
  console.log(`\nDone. ${created.length} requests. Ids saved to ${file}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
