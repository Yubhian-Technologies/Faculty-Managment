/**
 * READ-ONLY report: for every faculty member with a login, does the college email on the faculty record agree with the
 * login's email in users/{uid}, systemUsers/{uid} and Firebase Auth? Also lists college emails shared by two faculty
 * records. It never writes anything and never "fixes" a mismatch - a mismatch needs a manual decision (the College Office
 * "Change College Email" action refuses such accounts on purpose).
 *
 * Usage:  node scripts/audit-faculty-email-sync.mjs [--college=<collegeId>]
 */
import { init, parseArgs } from "./lib/scriptKit.mjs";
import { getAuth } from "firebase-admin/auth";

const { opt } = parseArgs();
const onlyCollege = opt("college");
const { db } = init();
const auth = getAuth();
const lc = (v) => String(v ?? "").trim().toLowerCase();

const colleges = onlyCollege ? [db.collection("colleges").doc(onlyCollege)] : (await db.collection("colleges").get()).docs.map((d) => d.ref);
let total = 0, mismatched = 0;
for (const college of colleges) {
  const fac = await college.collection("facultyMembers").select("employeeId", "collegeEmail", "userUid").get();
  if (fac.empty) continue;
  const users = new Map((await college.collection("users").get()).docs.map((d) => [d.id, d.data()]));
  const seen = new Map();
  console.log(`\n== ${college.id}: ${fac.size} faculty`);
  for (const d of fac.docs) {
    const f = d.data();
    total++;
    if (lc(f.collegeEmail)) seen.set(lc(f.collegeEmail), [...(seen.get(lc(f.collegeEmail)) ?? []), f.employeeId]);
    if (!f.userUid) continue;
    const u = users.get(f.userUid);
    const system = (await db.collection("systemUsers").doc(f.userUid).get()).data();
    let authEmail = "(no Auth user)";
    try { authEmail = (await auth.getUser(f.userUid)).email ?? ""; } catch { /* reported below */ }
    const issues = [];
    if (!u) issues.push("no users doc");
    else {
      if (lc(u.email) !== lc(f.collegeEmail)) issues.push(`users.email=${u.email}`);
      if (u.collegeEmail !== undefined && lc(u.collegeEmail) !== lc(f.collegeEmail)) issues.push(`users.collegeEmail=${u.collegeEmail}`);
    }
    if (system && lc(system.email) !== lc(f.collegeEmail)) issues.push(`systemUsers.email=${system.email}`);
    if (lc(authEmail) !== lc(f.collegeEmail)) issues.push(`auth=${authEmail}`);
    if (issues.length) { mismatched++; console.log(`   ${f.employeeId} (${d.id}): record=${f.collegeEmail}  ->  ${issues.join(" | ")}`); }
  }
  for (const [email, ids] of seen) if (ids.length > 1) console.log(`   SHARED college email ${email}: ${ids.join(", ")}`);
}
console.log(`\nFaculty checked: ${total}; with a mismatch: ${mismatched}. Nothing was written.`);
