/**
 * Test-environment seeder: past student-attendance records for ONE section
 * (default: Yubhian Engineering College / CSE / year 3 / every section found).
 *
 *   node scripts/seed-test-attendance.mjs                  # seed (finds existing college/section/students)
 *   node scripts/seed-test-attendance.mjs --create-missing # also create a bare college/dept/course/section/students/assignments when none exist
 *   node scripts/seed-test-attendance.mjs --cleanup        # delete everything this script wrote
 *   node scripts/seed-test-attendance.mjs --dry-run        # print the plan, write nothing
 *
 * Options: --college "Yubhian Engineering College" --dept CSE --year 3 --section A
 *          --from 2026-08-03 --to 2026-09-30 --periods 5
 *
 * Credentials (pick one):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080  (no credentials needed; project demo-fms)
 *   FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY  (same vars the app uses)
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Every document written here carries `seedTag: "fms-test-seed"`, so --cleanup removes
 * exactly what was added and nothing else. Existing students/assignments are never modified.
 * Attendance sessions are written with the same doc id / shape the app itself uses
 * (`${assignmentId}_${date}_${period}`), so the HOD / Principal reports read them natively.
 */
import { initializeApp, cert, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const TAG = "fms-test-seed";
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const COLLEGE_NAME = opt("college", "Yubhian Engineering College");
const DEPT = opt("dept", "CSE");
const YEAR = Number(opt("year", "3"));
const ONLY_SECTION = opt("section", "");
const FROM = opt("from", "2026-08-03");
const TO = opt("to", "2026-09-30");
const PERIODS_PER_DAY = Number(opt("periods", "5"));
const SEMESTER = Number(opt("semester", String(YEAR * 2 - 1))); // 3rd year, odd semester -> 5

if (!getApps().length) {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: process.env.FIREBASE_ADMIN_PROJECT_ID || "demo-fms" });
  } else if (process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
  } else {
    initializeApp({ credential: applicationDefault() });
  }
}
const db = getFirestore();
const now = Timestamp.now();

// ── deterministic PRNG so reruns produce identical data ───────────────────────
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ── student attendance personas: different data per student ──────────────────
// rate = probability of PRESENT; `joinedAfter` = not on the roster before that date;
// `streak` = absent for a run of consecutive days (e.g. illness).
const PERSONAS = [
  { rate: 0.99, label: "excellent" },
  { rate: 0.96, label: "excellent" },
  { rate: 0.93, label: "good" },
  { rate: 0.90, label: "good" },
  { rate: 0.86, label: "good" },
  { rate: 0.80, label: "ok" },
  { rate: 0.77, label: "borderline" },
  { rate: 0.74, label: "shortage-just" },
  { rate: 0.68, label: "shortage" },
  { rate: 0.60, label: "shortage" },
  { rate: 0.45, label: "poor" },
  { rate: 0.25, label: "very-poor" },
  { rate: 0.92, label: "late-joiner", joinedAfter: "2026-09-01" },
  { rate: 0.85, label: "illness-streak", streak: { from: "2026-08-17", days: 6 } },
  { rate: 1.0, label: "perfect" },
  { rate: 0.0, label: "never-present" },
];

function datesBetween(from, to) {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === 0) continue; // Sunday
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
const HOLIDAYS = new Set(["2026-08-15", "2026-09-05", "2026-09-14"]); // Independence Day, Teachers' Day, Ganesh Chaturthi (no classes)

async function findCollege() {
  const snap = await db.collection("colleges").get();
  const want = COLLEGE_NAME.trim().toLowerCase();
  return snap.docs.find((d) => String(d.data().name ?? "").trim().toLowerCase() === want)
    ?? snap.docs.find((d) => String(d.data().name ?? "").toLowerCase().includes(want));
}

// ── cleanup ──────────────────────────────────────────────────────────────────
async function cleanup(collegeRef) {
  const colls = ["studentAttendance", "teachingAssignments", "students", "sections", "subjects", "users", "courseYearTimings", "courses", "departments", "faculty"];
  let total = 0;
  for (const c of colls) {
    const snap = await collegeRef.collection(c).where("seedTag", "==", TAG).get();
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = db.batch();
      snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    if (snap.size) console.log(`  deleted ${snap.size} from ${c}`);
    total += snap.size;
  }
  if ((await collegeRef.get()).data()?.seedTag === TAG) { await collegeRef.delete(); console.log("  deleted college"); }
  console.log(`cleanup done (${total} docs)`);
}

// ── bare fixtures, only with --create-missing ────────────────────────────────
async function createFixtures(collegeRef, collegeId) {
  const deptRef = collegeRef.collection("departments").doc("seed-dept-cse");
  const courseRef = collegeRef.collection("courses").doc("seed-course-btech-cse");
  await deptRef.set({ collegeId, name: DEPT, code: DEPT, isActive: true, assignedYears: [2, 3, 4], seedTag: TAG, createdAt: now }, { merge: true });
  await courseRef.set({ collegeId, departmentId: deptRef.id, name: "B.Tech", code: "BTECH", durationYears: 4, isActive: true, seedTag: TAG, createdAt: now }, { merge: true });
  await collegeRef.collection("courseYearTimings").doc(`${courseRef.id}_year${YEAR}`).set({
    collegeId, departmentId: deptRef.id, courseId: courseRef.id, year: YEAR,
    collegeStartTime: "09:00", numberOfPeriods: PERIODS_PER_DAY, periodDurationMinutes: 50,
    lunchBreak: { afterPeriod: 3, durationMinutes: 45 }, shortBreaks: [],
    semesters: [
      { semester: SEMESTER, startDate: Timestamp.fromDate(new Date("2026-07-20T00:00:00Z")), endDate: Timestamp.fromDate(new Date("2026-12-19T00:00:00Z")) },
    ],
    seedTag: TAG, createdAt: now,
  }, { merge: true });
  const secRef = collegeRef.collection("sections").doc("seed-sec-cse-3-a");
  await secRef.set({
    collegeId, department: DEPT, courseId: courseRef.id, courseName: "B.Tech", name: "A", year: YEAR,
    batch: "2023-2027", studentCount: PERSONAS.length, seedTag: TAG, createdAt: now, updatedAt: now,
  }, { merge: true });
  const batch = db.batch();
  PERSONAS.forEach((p, i) => {
    const n = String(i + 1).padStart(2, "0");
    batch.set(collegeRef.collection("students").doc(`seed-stu-${n}`), {
      collegeId, department: DEPT, courseId: courseRef.id, section: "A", year: YEAR,
      rollNumber: `23YEC${DEPT}${n}`, name: `Test Student ${n} (${p.label})`, status: "REGULAR",
      hosteller: i % 3 === 0, seedTag: TAG, createdAt: now, updatedAt: now,
    }, { merge: true });
  });
  await batch.commit();
  const subjects = [["CS501", "Operating Systems"], ["CS502", "Computer Networks"], ["CS503", "Database Management"], ["CS504", "Compiler Design"], ["CS505", "Machine Learning"]];
  const facultyNames = ["Dr. A. Rao", "Dr. B. Kumar", "Ms. C. Devi", "Mr. D. Reddy", "Dr. E. Sharma"];
  for (let i = 0; i < subjects.length; i++) {
    const [code, name] = subjects[i];
    await collegeRef.collection("teachingAssignments").doc(`seed-ta-${code.toLowerCase()}`).set({
      collegeId, facultyId: `seed-fac-${i + 1}`, facultyName: facultyNames[i], department: DEPT,
      courseId: courseRef.id, courseName: "B.Tech", sectionId: secRef.id, sectionName: "A", year: YEAR,
      subjectId: `seed-sub-${code.toLowerCase()}`, subjectName: name, subjectCode: code,
      hoursPerWeek: 4, assignedBy: "seed", assignedByName: "Test seed", timetableSemester: SEMESTER,
      isPast: false, seedTag: TAG, createdAt: now, updatedAt: now,
    }, { merge: true });
  }
}

async function main() {
  let collegeDoc = await findCollege();
  if (flag("cleanup")) {
    if (!collegeDoc) { console.log("college not found; nothing to clean"); return; }
    console.log(`cleaning ${collegeDoc.data().name} (${collegeDoc.id})`);
    return cleanup(collegeDoc.ref);
  }
  if (!collegeDoc) {
    if (!flag("create-missing")) {
      console.error(`College "${COLLEGE_NAME}" not found. Re-run with --create-missing to create a bare test college.`);
      process.exit(1);
    }
    if (flag("dry-run")) { console.log("dry-run: would create college + fixtures"); return; }
    const ref = db.collection("colleges").doc("seed-yubhian-engineering-college");
    await ref.set({ name: COLLEGE_NAME, isActive: true, seedTag: TAG, createdAt: now });
    collegeDoc = await ref.get();
  }
  const collegeRef = collegeDoc.ref;
  const collegeId = collegeDoc.id;
  console.log(`college: ${collegeDoc.data().name} (${collegeId})`);

  let sectionsSnap = await collegeRef.collection("sections").where("department", "==", DEPT).where("year", "==", YEAR).get();
  if (sectionsSnap.empty && flag("create-missing") && !flag("dry-run")) {
    await createFixtures(collegeRef, collegeId);
    sectionsSnap = await collegeRef.collection("sections").where("department", "==", DEPT).where("year", "==", YEAR).get();
  }
  let sections = sectionsSnap.docs.filter((d) => !ONLY_SECTION || d.data().name === ONLY_SECTION);
  if (!sections.length) { console.error(`No ${DEPT} year-${YEAR} section found${ONLY_SECTION ? ` named ${ONLY_SECTION}` : ""}.`); process.exit(1); }

  const days = datesBetween(FROM, TO).filter((d) => !HOLIDAYS.has(d));
  let written = 0;

  for (const secDoc of sections) {
    const sec = secDoc.data();
    const label = `${DEPT} year ${YEAR} section ${sec.name}`;
    const studentsSnap = await collegeRef.collection("students")
      .where("department", "==", sec.department).where("section", "==", sec.name).where("year", "==", sec.year).get();
    const students = studentsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => !sec.courseId || !s.courseId || s.courseId === sec.courseId)
      .sort((a, b) => String(a.rollNumber).localeCompare(String(b.rollNumber), undefined, { numeric: true }));
    const taSnap = await collegeRef.collection("teachingAssignments").where("sectionId", "==", secDoc.id).get();
    const assignments = taSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => !a.isPast);
    console.log(`${label}: ${students.length} students, ${assignments.length} teaching assignments, ${days.length} class days`);
    if (!students.length || !assignments.length) {
      console.error(`  skipping: needs students and teaching assignments (use --create-missing on an empty environment)`);
      continue;
    }
    assignments.sort((a, b) => String(a.subjectCode).localeCompare(String(b.subjectCode)));

    // Persona per student, by roster order (cycled if the section is bigger than PERSONAS).
    const persona = (i) => PERSONAS[i % PERSONAS.length];
    const rand = rng(1234 + secDoc.id.length);

    const docs = [];
    for (const [di, date] of days.entries()) {
      for (let p = 1; p <= PERIODS_PER_DAY; p++) {
        // Rotate subjects through the week so each subject gets ~equal periods; leave a free period now and then.
        const a = assignments[(di * PERIODS_PER_DAY + p - 1 + (new Date(`${date}T00:00:00Z`).getUTCDay())) % assignments.length];
        if (rand() < 0.08) continue; // occasionally nothing scheduled in this slot
        const roster = students.filter((s, i) => !(persona(i).joinedAfter && date < persona(i).joinedAfter));
        const entries = roster.map((s) => {
          const i = students.indexOf(s);
          const ps = persona(i);
          let present = rand() < ps.rate;
          if (ps.streak) {
            const end = new Date(`${ps.streak.from}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + ps.streak.days);
            if (date >= ps.streak.from && date < end.toISOString().slice(0, 10)) present = false;
          }
          return { studentId: s.id, rollNumber: s.rollNumber, name: s.name, status: present ? "PRESENT" : "ABSENT" };
        });
        // The last two sessions of the range are left as drafts to prove reports ignore unsubmitted data.
        const isDraft = date >= days[days.length - 1] && p >= PERIODS_PER_DAY - 1;
        const submittedAt = Timestamp.fromDate(new Date(`${date}T${String(8 + p).padStart(2, "0")}:45:00+05:30`));
        docs.push({
          ref: collegeRef.collection("studentAttendance").doc(`${a.id}_${date}_${p}`),
          data: {
            collegeId, department: sec.department, assignmentId: a.id, sectionId: secDoc.id, sectionName: sec.name,
            year: sec.year, semester: a.timetableSemester ?? SEMESTER,
            subjectId: a.subjectId, subjectName: a.subjectName, subjectCode: a.subjectCode,
            facultyId: a.facultyId, facultyName: a.facultyName, date, periodNumber: p,
            status: isDraft ? "DRAFT" : "SUBMITTED", entries,
            totalStudents: entries.length, presentCount: entries.filter((e) => e.status === "PRESENT").length,
            classNotes: `Seeded class record for ${a.subjectName}`,
            submittedAt: isDraft ? null : submittedAt, createdAt: submittedAt, updatedAt: submittedAt, seedTag: TAG,
          },
        });
      }
    }
    console.log(`  ${docs.length} attendance sessions to write (${docs.filter((d) => d.data.status === "DRAFT").length} drafts)`);
    if (flag("dry-run")) continue;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      docs.slice(i, i + 400).forEach((d) => batch.set(d.ref, d.data));
      await batch.commit();
    }
    written += docs.length;

    // Expected figures, so the person checking the reports has ground truth.
    console.log("  expected overall % (till now, submitted sessions only):");
    const submitted = docs.filter((d) => d.data.status === "SUBMITTED");
    students.forEach((s, i) => {
      let held = 0, att = 0;
      for (const d of submitted) {
        const e = d.data.entries.find((x) => x.studentId === s.id);
        if (!e) continue;
        held++; if (e.status === "PRESENT") att++;
      }
      console.log(`    ${String(s.rollNumber).padEnd(14)} ${persona(i).label.padEnd(15)} ${String(att).padStart(3)}/${String(held).padEnd(3)} = ${held ? ((att / held) * 100).toFixed(1) : "-"}%`);
    });
  }
  console.log(flag("dry-run") ? "dry-run complete" : `done: ${written} sessions written (tag ${TAG}; undo with --cleanup)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
