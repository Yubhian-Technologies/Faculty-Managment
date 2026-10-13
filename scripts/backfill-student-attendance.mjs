/**
 * Seeds SUBMITTED student-attendance sessions for a section's past N calendar days, for demo/
 * seeding purposes. The live app has no path for this: POST/PATCH /api/college/student-attendance
 * only accept today's date (WRONG_DATE gate) and the office-correction route only allows the
 * current month up to the 25th - so this writes colleges/{collegeId}/studentAttendance directly
 * with the admin SDK, in the exact shape the real routes write (see src/types/studentAttendance.ts
 * and src/app/api/college/student-attendance/route.ts).
 *
 * What it does, per teaching day in the window: one SUBMITTED session per (assignment, date,
 * period) already on the section's PUBLISHED timetableSlots, with each roster student marked
 * PRESENT/ABSENT at random (--presentRate). A split-lab period's two TimetableSlot halves each
 * get their own session against their own half of the roster, same as the live route.
 *
 * Simplifications (seeding, not a real correction - see conversation): no ON_DUTY overlay (no
 * real permissions exist for fabricated history); roster/timetable/faculty are read as they are
 * TODAY and applied to every backfilled date (a mid-window join/leave/faculty-swap is not
 * reconstructed); classNotes is a generic placeholder, not a real lesson note.
 *
 * NEVER overwrites a doc that already exists (idempotent - a real or previously-seeded session
 * for that assignment/date/period is left untouched; re-running only fills gaps).
 *
 * Usage:
 *   node scripts/backfill-student-attendance.mjs --college=YEC --department=CSE --section=A --year=3
 *       -> DRY RUN: prints the plan, writes nothing
 *   node scripts/backfill-student-attendance.mjs --college=YEC --department=CSE --section=A --year=3 --apply
 *       -> backs up the list of doc paths it is about to create, then writes
 *   Optional: --days=30 (default 30) --presentRate=0.9 (default 0.9, chance of PRESENT per student per period)
 */
import { Timestamp } from "firebase-admin/firestore";
import { init, parseArgs, writeBackup, banner } from "./lib/scriptKit.mjs";

const { apply, opt } = parseArgs();
const collegeTerm = opt("college") ?? "YEC";
const department = opt("department") ?? "CSE";
const sectionName = opt("section") ?? "A";
const year = Number(opt("year") ?? 3);
const days = Number(opt("days") ?? 30);
const presentRate = Number(opt("presentRate") ?? 0.9);
const { db } = init();
banner(apply);

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_BY_JS_DAY = { 1: "MON", 2: "TUE", 3: "WED", 4: "THU", 5: "FRI", 6: "SAT" }; // matches src/lib/timetable/currentPeriod.ts
const DEFAULT_WORKING_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT"]; // DEFAULT_TIMETABLE_RULES.workingDays
const istMidnightUTCms = (y, m, d) => Date.UTC(y, m - 1, d) - IST_OFFSET_MS;
const CLASS_NOTES = [
  "Topic covered as per lesson plan.",
  "Continued previous session's topic with examples.",
  "Conducted a problem-solving session.",
  "Reviewed key concepts and assigned practice problems.",
  "Introduced a new topic for the course.",
];

/** Firestore's getAll() throws on zero refs - every call site here can legitimately have none. */
async function getAllSafe(refs) {
  return refs.length ? db.getAll(...refs) : [];
}

async function resolveCollege(term) {
  const direct = await db.collection("colleges").doc(term).get();
  if (direct.exists) return { id: direct.id, ...direct.data() };
  const snap = await db.collection("colleges").get();
  const needle = term.toLowerCase();
  const exact = snap.docs.filter((d) => (d.data().name ?? "").toLowerCase() === needle);
  const matches = exact.length ? exact : snap.docs.filter((d) => (d.data().name ?? "").toLowerCase().includes(needle));
  if (matches.length === 1) return { id: matches[0].id, ...matches[0].data() };
  if (matches.length === 0) throw new Error(`No college found matching "${term}"`);
  throw new Error(`Multiple colleges match "${term}": ${matches.map((d) => `${d.id} (${d.data().name})`).join(", ")}`);
}

async function resolveSection(collegeRef, dep, sec, yr) {
  const snap = await collegeRef.collection("sections").get();
  const depN = dep.toLowerCase(), secN = sec.toLowerCase();
  const matches = snap.docs.filter((d) => {
    const v = d.data();
    return (v.department ?? "").toLowerCase() === depN && (v.name ?? "").toLowerCase() === secN && Number(v.year) === yr;
  });
  if (matches.length === 1) return { id: matches[0].id, ...matches[0].data() };
  if (matches.length === 0) throw new Error(`No section found for department="${dep}" name="${sec}" year=${yr}`);
  throw new Error(`Multiple sections matched (unexpected): ${matches.map((d) => d.id).join(", ")}`);
}

/** Same calendar rule as src/lib/studentAttendance/classDay.ts noClassReason. */
function noClassReason(dateISO, workingDays, holidays, summerBreaks) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (jsDay === 0) return "Sunday";
  const day = DAY_BY_JS_DAY[jsDay];
  if (!workingDays.includes(day)) return "Not a working day";
  if (holidays.some((h) => h === dateISO)) return "Holiday";
  if (summerBreaks.some((b) => dateISO >= b.from && dateISO <= b.to)) return "Summer break";
  return null;
}

/** Same roster rule as src/lib/students/sectionRoster.ts fetchSectionStudents. */
async function fetchSectionStudents(collegeRef, { dep, sec, yr, courseId, labBatch }) {
  let primary = collegeRef.collection("students").where("department", "==", dep).where("section", "==", sec).where("year", "==", yr);
  let secondary = collegeRef.collection("students").where("secondaryDepartment", "==", dep).where("section", "==", sec).where("year", "==", yr);
  if (courseId) { primary = primary.where("courseId", "==", courseId); secondary = secondary.where("courseId", "==", courseId); }
  const [p, s] = await Promise.all([primary.get(), secondary.get()]);
  const seen = new Set();
  const students = [];
  for (const doc of [...p.docs, ...s.docs]) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    const data = doc.data();
    if (data.status === "GRADUATED") continue;
    students.push({ id: doc.id, ...data });
  }
  if (labBatch) {
    const wanted = labBatch.trim().toLowerCase();
    return students.filter((st) => (st.labBatch ?? "").trim().toLowerCase() === wanted);
  }
  return students;
}

/** Same rule as src/lib/students/labBatchMode.ts effectiveLabBatch. */
function effectiveLabBatch(slotLabBatch, mode, facultyId) {
  if (!mode) return slotLabBatch || undefined;
  if (mode.batchWise === false) return undefined;
  return mode.batchByFaculty?.[facultyId] || slotLabBatch || undefined;
}

const college = await resolveCollege(collegeTerm);
console.log(`College: ${college.id} (${college.name ?? "?"})`);
const collegeRef = db.collection("colleges").doc(college.id);

const section = await resolveSection(collegeRef, department, sectionName, year);
console.log(`Section: ${section.id} — department="${section.department}" name="${section.name}" year=${section.year} courseId=${section.courseId ?? "(none)"}`);

// Calendar for the window: today (IST) minus 1..days, oldest first - today itself is left alone
// (the live app can still mark it normally).
const todayISO = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const [ty, tm, td] = todayISO.split("-").map(Number);
const todayUTC = Date.UTC(ty, tm - 1, td);

const [rulesSnap, holidaySnap, summerSnap] = await Promise.all([
  collegeRef.collection("settings").doc("timetableRules").get(),
  collegeRef.collection("holidays").get(),
  collegeRef.collection("summerHolidays").get(),
]);
const workingDays = rulesSnap.exists && rulesSnap.data().workingDays?.length ? rulesSnap.data().workingDays : DEFAULT_WORKING_DAYS;
const holidays = holidaySnap.docs.map((d) => {
  const v = d.data();
  const dt = v.date?.toDate?.();
  return dt ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(dt) : null;
}).filter(Boolean);
const summerBreaks = summerSnap.docs.map((d) => {
  const v = d.data();
  const from = v.fromDate?.toDate?.(), to = v.toDate?.toDate?.();
  if (!from || !to) return null;
  const fmt = (dt) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(dt);
  return { from: fmt(from), to: fmt(to) };
}).filter(Boolean);

const classDates = [];
for (let i = 1; i <= days; i++) {
  const dateISO = new Date(todayUTC - i * 86_400_000).toISOString().slice(0, 10);
  if (noClassReason(dateISO, workingDays, holidays, summerBreaks) === null) classDates.push(dateISO);
}
classDates.sort();
console.log(`Window: last ${days} calendar days before ${todayISO} -> ${classDates.length} teaching days.`);
if (classDates.length === 0) { console.log("Nothing to do (no teaching days in range)."); process.exit(0); }

// Published periods for this section, grouped by weekday.
const slotsSnap = await collegeRef.collection("timetableSlots").where("sectionId", "==", section.id).get();
const slots = slotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
if (slots.length === 0) { console.log("No published timetableSlots for this section - nothing to backfill."); process.exit(0); }

const assignmentIds = [...new Set(slots.map((s) => s.assignmentId).filter(Boolean))];
const assignmentSnaps = await getAllSafe(assignmentIds.map((id) => collegeRef.collection("teachingAssignments").doc(id)));
const assignments = new Map(assignmentSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()]));

const facultyMemberIds = [...new Set(slots.map((s) => s.facultyId).filter(Boolean))];
const facultySnaps = await getAllSafe(facultyMemberIds.map((id) => collegeRef.collection("facultyMembers").doc(id)));
const facultyMembers = new Map(facultySnaps.filter((s) => s.exists).map((s) => [s.id, s.data()]));

const labSettingKeys = [...new Set(slots.filter((s) => s.labBatch).map((s) => `${section.id}_${s.subjectId}`))];
const labSettingSnaps = await getAllSafe(labSettingKeys.map((id) => collegeRef.collection("sectionLabBatchSettings").doc(id)));
const labSettings = new Map(labSettingSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()]));

// Resolve each slot's concrete attendance identity once; skip what we can't legitimately write.
const resolvedSlots = [];
const skippedSlots = [];
for (const slot of slots) {
  const assignment = assignmentIds.length ? assignments.get(slot.assignmentId) : undefined;
  if (!assignment || assignment.isPast) { skippedSlots.push(`${slot.id}: no live teaching assignment (${slot.assignmentId})`); continue; }
  const facultyMember = facultyMembers.get(slot.facultyId);
  const loginUid = facultyMember?.userUid;
  if (!loginUid) { skippedSlots.push(`${slot.id}: faculty ${slot.facultyId} has no linked login (userUid) - can't attribute a session to them`); continue; }
  const mode = slot.labBatch ? labSettings.get(`${section.id}_${slot.subjectId}`) : undefined;
  const labBatch = effectiveLabBatch(slot.labBatch, mode, slot.facultyId);
  resolvedSlots.push({
    day: slot.day,
    periodNumber: slot.periodNumber,
    assignmentId: slot.assignmentId,
    subjectId: slot.subjectId,
    subjectName: slot.subjectName,
    subjectCode: assignment.subjectCode,
    facultyLoginUid: loginUid,
    facultyName: assignment.facultyName ?? facultyMember?.legalName ?? "",
    semester: section.id === assignment.sectionId ? assignment.timetableSemester : assignment.semester,
    labBatch,
  });
}
if (skippedSlots.length) console.log(`Skipping ${skippedSlots.length} published period(s):\n  - ${skippedSlots.join("\n  - ")}`);
if (resolvedSlots.length === 0) { console.log("No usable published periods for this section - nothing to backfill."); process.exit(0); }

// One roster fetch per distinct lab-batch value actually needed (undefined = whole section).
const labBatchValues = [...new Set(resolvedSlots.map((s) => s.labBatch ?? ""))];
const rosterByLabBatch = new Map();
for (const lb of labBatchValues) {
  const roster = await fetchSectionStudents(collegeRef, { dep: section.department, sec: section.name, yr: section.year, courseId: section.courseId, labBatch: lb || undefined });
  roster.sort((a, b) => (a.rollNumber ?? "").localeCompare(b.rollNumber ?? "", undefined, { numeric: true }) || (a.name ?? "").localeCompare(b.name ?? ""));
  rosterByLabBatch.set(lb, roster);
  console.log(`Roster${lb ? ` (lab batch "${lb}")` : ""}: ${roster.length} students.`);
}
if ([...rosterByLabBatch.values()].every((r) => r.length === 0)) { console.log("Roster is empty - nothing to backfill."); process.exit(0); }

// Current academic-year label (same source as resolveCollegeAcademicYear) - a 30-day window
// essentially never crosses the boundary, so this one value is used for every backfilled date.
const sessionSnap = await collegeRef.collection("academicSessions").where("isCurrent", "==", true).limit(1).get();
const academicYear = sessionSnap.empty ? null : sessionSnap.docs[0].data().label ?? null;
if (!academicYear) console.log("NOTE: no current academicSession found - sessions will be written without an academicYear label.");

// Build the plan: one SUBMITTED session per (date, resolved slot) not already in Firestore.
const plan = [];
for (const dateISO of classDates) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const weekday = DAY_BY_JS_DAY[new Date(y, m - 1, d).getDay()];
  if (!weekday) continue;
  for (const slot of resolvedSlots) {
    if (slot.day !== weekday) continue;
    const id = `${slot.assignmentId}_${dateISO}_${slot.periodNumber}`;
    plan.push({ id, dateISO, slot });
  }
}
const existingSnaps = await getAllSafe(plan.map((p) => collegeRef.collection("studentAttendance").doc(p.id)));
const toCreate = [];
let alreadyExists = 0;
plan.forEach((p, i) => { if (existingSnaps[i].exists) alreadyExists++; else toCreate.push(p); });

console.log(`\nPlanned sessions: ${plan.length} total, ${alreadyExists} already exist (left untouched), ${toCreate.length} to create.`);
if (toCreate.length === 0) { console.log("Nothing to do."); process.exit(0); }

const docs = toCreate.map(({ id, dateISO, slot }) => {
  const roster = rosterByLabBatch.get(slot.labBatch ?? "");
  const entries = roster.map((s) => ({
    studentId: s.id,
    rollNumber: s.rollNumber ?? "",
    name: s.name ?? "",
    status: Math.random() < presentRate ? "PRESENT" : "ABSENT",
  }));
  const presentCount = entries.filter((e) => e.status === "PRESENT").length;
  const [y, m, d] = dateISO.split("-").map(Number);
  const ts = Timestamp.fromDate(new Date(istMidnightUTCms(y, m, d) + (8 + slot.periodNumber) * 3_600_000));
  const data = {
    collegeId: college.id,
    department: section.department,
    assignmentId: slot.assignmentId,
    sectionId: section.id,
    sectionName: section.name,
    year: section.year,
    ...(slot.semester != null ? { semester: slot.semester } : {}),
    ...(academicYear ? { academicYear } : {}),
    subjectId: slot.subjectId,
    subjectName: slot.subjectName,
    subjectCode: slot.subjectCode,
    facultyId: slot.facultyLoginUid,
    facultyName: slot.facultyName,
    date: dateISO,
    periodNumber: slot.periodNumber,
    ...(slot.labBatch ? { labBatch: slot.labBatch } : {}),
    status: "SUBMITTED",
    entries,
    totalStudents: entries.length,
    presentCount,
    classNotes: CLASS_NOTES[Math.floor(Math.random() * CLASS_NOTES.length)],
    submittedAt: ts,
    createdAt: ts,
    updatedAt: ts,
  };
  return { id, path: `${collegeRef.path}/studentAttendance/${id}`, data };
});

for (const d of docs.slice(0, 5)) console.log(`  - ${d.path} : ${d.data.date} P${d.data.periodNumber} ${d.data.subjectCode} (${d.data.presentCount}/${d.data.totalStudents} present)`);
if (docs.length > 5) console.log(`  ... and ${docs.length - 5} more`);

if (!apply) { console.log("\nDry run only - nothing was written. Re-run with --apply to write (the list of new doc paths is saved first)."); process.exit(0); }

const file = writeBackup("backfill-student-attendance", docs.map((d) => ({ path: d.path, note: "newly created by backfill - delete to revert" })));
console.log(`\nBackup (list of created doc paths) written: ${file}`);

let batch = db.batch();
let inBatch = 0;
for (const d of docs) {
  batch.set(collegeRef.collection("studentAttendance").doc(d.id), d.data);
  if (++inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
}
if (inBatch > 0) await batch.commit();
console.log(`Created ${docs.length} student-attendance session(s).`);

// Keep the per-student daily tally in sync when the feature flag is on (see dayTally.ts rebuildDay).
const tallyMode = process.env.ATTENDANCE_TALLY;
if (tallyMode === "shadow" || tallyMode === "on") {
  const touchedDates = [...new Set(docs.map((d) => d.data.date))];
  console.log(`ATTENDANCE_TALLY=${tallyMode} - rebuilding the tally for ${touchedDates.length} date(s)...`);
  for (const dateISO of touchedDates) {
    const snap = await collegeRef.collection("studentAttendance").where("date", "==", dateISO).where("status", "==", "SUBMITTED").get();
    const cells = new Map(); // `${studentId}|${sectionId}` -> subjectId -> {h,a}
    const names = new Map();
    for (const doc of snap.docs) {
      const s = doc.data();
      names.set(s.subjectId, { name: s.subjectName ?? "", code: s.subjectCode ?? "" });
      for (const e of s.entries) {
        if (e.status == null) continue;
        const key = `${e.studentId}|${s.sectionId ?? section.id}`;
        const entry = cells.get(key) ?? { studentId: e.studentId, subjects: new Map() };
        const cur = entry.subjects.get(s.subjectId) ?? { h: 0, a: 0 };
        cur.h += 1; cur.a += e.status === "PRESENT" ? 1 : 0;
        entry.subjects.set(s.subjectId, cur);
        cells.set(key, entry);
      }
    }
    let tb = db.batch(), tn = 0;
    for (const [key, { studentId, subjects }] of cells) {
      const sectionKey = key.split("|")[1];
      const bySubject = {}; const nameFields = {};
      for (const [subjectId, c] of subjects) { bySubject[subjectId] = c; nameFields[subjectId] = names.get(subjectId); }
      tb.set(collegeRef.collection("studentAttendanceTally").doc(`${studentId}_${dateISO.slice(0, 7)}`), {
        studentId, month: dateISO.slice(0, 7), sections: { [sectionKey]: { [dateISO]: bySubject } }, names: nameFields,
      }, { merge: true });
      if (++tn >= 400) { await tb.commit(); tb = db.batch(); tn = 0; }
    }
    if (tn > 0) await tb.commit();
  }
  console.log("Tally rebuilt.");
}
