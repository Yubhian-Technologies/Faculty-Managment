/**
 * READ-ONLY data checks for the student-attendance audit. Writes nothing (no --apply exists).
 *
 *   1. alumni      GRADUATED students whose (department, section, year, course) still matches a live section.
 *                  These were on attendance rosters before roster/count started excluding them.
 *   2. duplicates  SUBMITTED sessions that share (sectionId, subjectId, date, periodNumber, labBatch) but have
 *                  different ids, i.e. the same class counted twice (audit D-14).
 *   3. empty       sessions with totalStudents == 0 (audit D-11).
 *   4. subjects    SUBMITTED sessions whose subject has no current (non-past) teaching assignment for the section.
 *                  These are what ATTENDANCE_REPORT_ALL_SUBJECTS=1 would start to count in staff reports (audit D-05).
 *
 * Usage:
 *   node scripts/attendance-data-checks.mjs [--college=<collegeId>] [--from=YYYY-MM-DD] [--only=alumni,duplicates,empty,subjects]
 * --from bounds checks 2 to 4 by session date (default: 120 days ago).
 */
import { init, parseArgs } from "./lib/scriptKit.mjs";

const { opt } = parseArgs();
const { db } = init();
console.log("MODE: READ ONLY - nothing is written\n");

const onlyCollege = opt("college");
const only = new Set((opt("only") ?? "alumni,duplicates,empty,subjects").split(","));
const from = opt("from") ?? new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
const SHOW = 15;

const colleges = onlyCollege ? [db.collection("colleges").doc(onlyCollege)] : (await db.collection("colleges").get()).docs.map((d) => d.ref);
const show = (title, rows) => {
  console.log(`  ${title}: ${rows.length}`);
  for (const r of rows.slice(0, SHOW)) console.log("    ", JSON.stringify(r));
  if (rows.length > SHOW) console.log(`     ... and ${rows.length - SHOW} more`);
};

for (const college of colleges) {
  console.log(`College ${college.id}`);
  const sectionsSnap = await college.collection("sections").get();
  const sections = sectionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (only.has("alumni")) {
    const grads = (await college.collection("students").where("status", "==", "GRADUATED").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    const hit = new Map(); // section id -> count
    for (const g of grads) {
      for (const sec of sections) {
        const deptMatch = sec.department === g.department || sec.department === g.secondaryDepartment;
        if (deptMatch && sec.name === g.section && sec.year === g.year && (!g.courseId || !sec.courseId || sec.courseId === g.courseId)) {
          hit.set(sec.id, { sectionId: sec.id, department: sec.department, section: sec.name, year: sec.year, alumni: (hit.get(sec.id)?.alumni ?? 0) + 1 });
        }
      }
    }
    console.log(`  graduated students in college: ${grads.length}`);
    show("sections that still match alumni (check 1)", [...hit.values()].sort((a, b) => b.alumni - a.alumni));
  }

  if (only.has("duplicates") || only.has("subjects") || only.has("empty")) {
    const sessSnap = await college.collection("studentAttendance").where("date", ">=", from).get();
    const sessions = sessSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    console.log(`  sessions since ${from}: ${sessions.length}`);

    if (only.has("empty")) {
      show("sessions with 0 students (check 3)", sessions.filter((s) => s.totalStudents === 0).map((s) => ({ id: s.id, status: s.status, section: s.sectionName, subject: s.subjectName })));
    }

    if (only.has("duplicates")) {
      const groups = new Map();
      for (const s of sessions) {
        if (s.status !== "SUBMITTED" || !s.sectionId) continue;
        const key = [s.sectionId, s.subjectId, s.date, s.periodNumber ?? "", s.labBatch ?? ""].join("|");
        groups.set(key, [...(groups.get(key) ?? []), s.id]);
      }
      show("same class counted more than once (check 2)", [...groups.entries()].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, ids })));
    }

    if (only.has("subjects")) {
      const assignSnap = await college.collection("teachingAssignments").get();
      const current = new Map(); // sectionId -> Set(subjectId)
      for (const a of assignSnap.docs.map((d) => d.data())) {
        if (a.isPast || !a.sectionId) continue;
        current.set(a.sectionId, (current.get(a.sectionId) ?? new Set()).add(a.subjectId));
      }
      const orphan = new Map(); // sectionId|subjectId -> sessions
      for (const s of sessions) {
        if (s.status !== "SUBMITTED" || !s.sectionId) continue;
        if (current.get(s.sectionId)?.has(s.subjectId)) continue;
        const k = `${s.sectionId}|${s.subjectId}`;
        orphan.set(k, { section: s.sectionName, year: s.year, subject: s.subjectName, sessions: (orphan.get(k)?.sessions ?? 0) + 1 });
      }
      show("subjects with sessions but no current assignment (check 4)", [...orphan.values()].sort((a, b) => b.sessions - a.sessions));
    }
  }
  console.log("");
}
