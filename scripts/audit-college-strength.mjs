/**
 * READ-ONLY. Never writes to Firestore.
 *   node scripts/audit-college-strength.mjs                    -> lists colleges (id, name)
 *   node scripts/audit-college-strength.mjs --college=<id>     -> dumps students/sections/departments/courses to backups/ (git-ignored)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { init, parseArgs } from "./lib/scriptKit.mjs";

const { opt } = parseArgs();
const { db } = init();
const collegeId = opt("college");

if (!collegeId) {
  const snap = await db.collection("colleges").select("name", "collegeCategory").get();
  for (const d of snap.docs) console.log(`${d.id}\t${d.data().name ?? ""}\t${d.data().collegeCategory ?? "MAIN"}`);
  process.exit(0);
}

const college = db.collection("colleges").doc(collegeId);
const [students, sections, depts, courses] = await Promise.all([
  college.collection("students").select("department", "secondaryDepartment", "section", "year", "course", "courseId", "batch", "status", "rollNumber").get(),
  college.collection("sections").select("name", "department", "secondaryDepartments", "year", "courseName", "courseId", "studentCount").get(),
  college.collection("departments").select("name", "code", "parentDepartmentId", "isActive").get(),
  college.collection("courses").select("name", "departmentId", "catalogId").get(),
]);
const out = {
  students: students.docs.map((d) => ({ id: d.id, ...d.data() })),
  sections: sections.docs.map((d) => ({ id: d.id, ...d.data() })),
  departments: depts.docs.map((d) => ({ id: d.id, ...d.data() })),
  courses: courses.docs.map((d) => ({ id: d.id, ...d.data() })),
};
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "backups");
mkdirSync(dir, { recursive: true });
const file = join(dir, `strength-${collegeId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(out));
console.log(`students=${out.students.length} sections=${out.sections.length} departments=${out.departments.length} courses=${out.courses.length}\n${file}`);
