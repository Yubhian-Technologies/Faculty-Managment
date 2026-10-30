/**
 * READ-ONLY. Never writes to Firestore.
 * Finds student-permission requests whose approving department (`scope`) is NOT the student's own department or core branch -
 * e.g. a CSE student's request that went to the IT HOD - and shows why: which section owns the student, and which HOD logins
 * would see a request filed under that scope (their department / departments list, or a branch they manage).
 *
 *   node scripts/audit-permission-routing.mjs --college=<id>      -> one college
 *   node scripts/audit-permission-routing.mjs --college=<id> --all -> also list requests that look fine
 *
 * Prints request ids and department names only (no student names).
 */
import { init, parseArgs } from "./lib/scriptKit.mjs";

const { opt, flag } = parseArgs();
const collegeId = opt("college");
if (!collegeId) { console.error("Pass --college=<id>"); process.exit(1); }
const { db } = init();
console.log("READ-ONLY permission routing audit (nothing is written)\n");

const college = db.collection("colleges").doc(collegeId);
const [reqSnap, deptSnap, sectionSnap, userSnap] = await Promise.all([
  college.collection("approvalRequests").where("kind", "==", "STUDENT_PERMISSION").get(),
  college.collection("departments").get(),
  college.collection("sections").select("department", "name", "year").get(),
  college.collection("users").where("role", "in", ["HOD", "DEPARTMENT_OFFICE"]).get(),
]);
const departments = deptSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const sectionOwner = new Map(sectionSnap.docs.map((d) => [`${d.data().department}|${d.data().name}|${d.data().year}`, d.data().department]));
const hods = userSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

function whoSees(scope) {
  const out = new Set();
  for (const u of hods) {
    if (u.department === scope || (u.departments ?? []).includes(scope)) out.add(`${u.name ?? u.id} [${u.department ?? "-"}] (own)`);
  }
  for (const d of departments) {
    if ((d.managedDepartments ?? []).includes(scope)) {
      const hod = hods.find((u) => u.department === d.name || (u.departments ?? []).includes(d.name));
      out.add(`${hod?.name ?? d.name + " HOD"} [${d.name}] (manages ${scope})`);
    }
  }
  return [...out];
}

let bad = 0;
for (const r of reqSnap.docs) {
  const req = r.data();
  const ids = [...new Set((req.payload?.students ?? []).map((s) => s.id))];
  const studs = (await db.getAll(...ids.map((id) => college.collection("students").doc(id)))).filter((s) => s.exists).map((s) => s.data());
  const problems = [];
  for (const s of studs) {
    if (req.scope !== s.department && req.scope !== s.secondaryDepartment) {
      const sec = sectionOwner.get(`${s.department}|${s.section}|${s.year}`) ?? sectionOwner.get(`${s.secondaryDepartment}|${s.section}|${s.year}`) ?? "(no section found)";
      problems.push(`student dept "${s.department}"${s.secondaryDepartment ? ` / core "${s.secondaryDepartment}"` : ""}, section ${s.section} yr ${s.year} owned by "${sec}"`);
    }
  }
  if (problems.length || flag("all")) {
    if (problems.length) bad++;
    console.log(`${problems.length ? "MISMATCH" : "ok      "} ${r.id}  ${req.createdAt?.slice?.(0, 10) ?? ""}  status=${req.status}  scope="${req.scope}"  sees: ${whoSees(req.scope).join("; ") || "-"}`);
    for (const p of new Set(problems)) console.log(`           ${p}`);
  }
}
console.log(`\n${reqSnap.size} request(s) checked, ${bad} routed to a department the student is not in.`);
