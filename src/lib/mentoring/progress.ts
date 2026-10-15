import type { Firestore } from "firebase-admin/firestore";
import { cachedCollectionDocs } from "@/lib/firestore/sharedReads";
import { inheritedTimingCourseId } from "@/lib/timetable/sharedYearTiming";
import { istDateKey } from "@/lib/attendance/istTime";
import { effectiveJoiningDate } from "@/lib/studentAttendance/joiningDate";
import { computeStudentAttendanceHistory, studentDepartmentsForHistory } from "@/lib/studentAttendance/history";
import { loadAcademicYearConfig, windowForAcademicYear } from "@/lib/studentAttendance/academicYearWindow";
import { calcPercent } from "@/lib/studentAttendance/percentage";
import {
  currentSemesterOf,
  semesterOptionsForStudent,
  type SemesterRange,
  type YearTiming,
} from "@/lib/studentAttendance/studentReportRange";
import { loadResultRules } from "@/lib/examResults/store";
import { buildStudentResults } from "@/lib/examResults/studentResults";
import { finalSubjectsOfSemester, loadPublishedSittings } from "@/lib/examResults/studentSittings";
import { resolveExamConfigForBatch } from "@/lib/exams/internalExamMarks";
import type { CourseYearTiming, ExamConfiguration, InternalExamMarksBatch, StudentRecord } from "@/types";

// The read-only "progress" a mentor sees for one student - server only. Every
// builder here reads existing data exactly as the student's own pages and the
// Exam Cell / HOD views do; nothing is written and no new stored shape is
// introduced. Authorization is the caller's job (see access.ts).

// Course-year timing dates are stored as UTC-midnight Timestamps, so the UTC date is the configured one.
function toDateStr(v: unknown): string {
  const d = (v as { toDate?: () => Date })?.toDate ? (v as { toDate: () => Date }).toDate() : new Date(v as string);
  return d.toISOString().slice(0, 10);
}

// ── Attendance ───────────────────────────────────────────────────────────────

export interface MenteeAttendance {
  /** Semesters the student has reached, for the picker. */
  semesters: { semester: number; label: string }[];
  /** What the figures cover. */
  scope: { label: string; from: string | null; to: string | null };
  subjects: { subjectId: string; code: string; name: string; held: number; attended: number; percent: number | null }[];
  total: { held: number; attended: number; percent: number | null };
}

/** Every semester the student has reached (years 1..their year, start date passed), with its dates and year. */
export async function loadStudentSemesterRanges(
  db: Firestore,
  collegeId: string,
  student: Pick<StudentRecord, "courseId" | "year">
): Promise<SemesterRange[]> {
  if (!student.courseId || student.year < 1) return [];
  const courseId = student.courseId;
  const years = Array.from({ length: student.year }, (_, i) => i + 1);
  const timingsCol = db.collection("colleges").doc(collegeId).collection("courseYearTimings");

  // One batched read for every year's own timing (was one round trip per year) ...
  const own = await db.getAll(...years.map((y) => timingsCol.doc(`${courseId}_year${y}`)));
  const byYear = new Map<number, CourseYearTiming>();
  years.forEach((y, i) => { if (own[i].exists) byYear.set(y, own[i].data() as CourseYearTiming); });

  // ... and, only for a year the course has no timing of its own (a shared first year's branch), the
  // shared-year manager's - resolved with the same rule as loadEffectiveTiming, from the cached
  // courses / departments and one more batched read.
  const missing = years.filter((y) => !byYear.has(y));
  if (missing.length > 0) {
    const [courseDocs, deptDocs] = await Promise.all([
      cachedCollectionDocs(db, collegeId, "courses"),
      cachedCollectionDocs(db, collegeId, "departments"),
    ]);
    const courses = courseDocs.map((d) => ({ id: d.id, ...d.data() })) as unknown as Parameters<typeof inheritedTimingCourseId>[3];
    const departments = deptDocs.map((d) => ({ id: d.id, ...d.data() })) as unknown as Parameters<typeof inheritedTimingCourseId>[2];
    const ownCourse = courses.find((c) => c.id === courseId);
    if (ownCourse) {
      const inherited = missing
        .map((year) => ({ year, id: inheritedTimingCourseId(ownCourse, year, departments, courses) }))
        .filter((x): x is { year: number; id: string } => !!x.id);
      if (inherited.length > 0) {
        const snaps = await db.getAll(...inherited.map((x) => timingsCol.doc(`${x.id}_year${x.year}`)));
        inherited.forEach((x, i) => { if (snaps[i].exists) byYear.set(x.year, snaps[i].data() as CourseYearTiming); });
      }
    }
  }

  const timings: YearTiming[] = [];
  for (const year of years) {
    const timing = byYear.get(year);
    if (!timing?.semesters?.length) continue;
    timings.push({
      year,
      semesters: timing.semesters.map((s) => ({ semester: s.semester, startDate: toDateStr(s.startDate), endDate: toDateStr(s.endDate) })),
    });
  }
  return semesterOptionsForStudent(timings, student.year, istDateKey(new Date()));
}

export async function loadMenteeAttendance(
  db: Firestore,
  collegeId: string,
  student: StudentRecord & { id: string },
  semesterParam: number | null
): Promise<MenteeAttendance> {
  const semesters = await loadStudentSemesterRanges(db, collegeId, student);

  const today = istDateKey(new Date());
  const picked = semesterParam != null ? semesters.find((s) => s.semester === semesterParam) ?? null : null;
  const chosen = picked ?? currentSemesterOf(semesters, today);

  let from: string | null = null;
  let to: string | null = null;
  let label = "Current academic year";
  if (chosen) {
    from = chosen.startDate;
    // A running semester has no sessions past today, so its end date is safe as the bound.
    to = chosen.endDate;
    label = `Semester ${chosen.semester}${picked ? "" : " (till now)"}`;
  } else {
    const cfg = await loadAcademicYearConfig(db, collegeId);
    const win = windowForAcademicYear(cfg.currentLabel, cfg);
    if (win) {
      from = win.from;
      to = win.to;
      label = `${win.label} (till now)`;
    }
  }

  const departments = await studentDepartmentsForHistory(db, collegeId, student);
  const history = await computeStudentAttendanceHistory(
    db, collegeId, student.id, departments,
    from && to ? { from, to } : {},
    { joinedOn: effectiveJoiningDate(student) }
  );

  const subjects = history.subjects
    .map((s) => ({
      subjectId: s.subjectId,
      code: s.shortCode || s.subjectCode,
      name: s.subjectName,
      held: s.held,
      attended: s.attend,
      percent: calcPercent(s.attend, s.held),
    }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const held = subjects.reduce((n, r) => n + r.held, 0);
  const attended = subjects.reduce((n, r) => n + r.attended, 0);

  return {
    semesters: semesters.map((s) => ({ semester: s.semester, label: `Semester ${s.semester}` })),
    scope: { label, from, to },
    subjects,
    total: { held, attended, percent: calcPercent(attended, held) },
  };
}

// ── Semester results (grades, SGPA / CGPA) ───────────────────────────────────

export interface MenteeResultSubject {
  code: string;
  name: string;
  credits: number;
  grade: string;
  points: number;
  isPass: boolean;
  /** Earlier attempts of the same subject, oldest first (only when there were any). */
  earlier: { examType: string; grade: string }[];
}

export interface MenteeSemesterResult {
  semester: number;
  year: number;
  academicYear: string;
  subjects: MenteeResultSubject[];
  sgpa: number | null;
  sgpaWithheld: boolean;
  cgpa: number | null;
  cgpaWithheld: boolean;
  /** Subject codes of this semester not passed yet. */
  backlogs: string[];
}

export interface MenteeResults {
  semesters: MenteeSemesterResult[];
  /** Subject codes of any semester still not passed (as of the latest published semester). */
  backlogs: string[];
  decimals: number;
}

export async function loadMenteeResults(db: Firestore, collegeId: string, studentId: string): Promise<MenteeResults> {
  const [{ rules }, sittings] = await Promise.all([
    loadResultRules(db, collegeId),
    loadPublishedSittings(db, collegeId, studentId),
  ]);
  // The very same engine as the student's own Results page: revaluations (best of two), the latest
  // passing attempt and the college's show rules, so mentor and student always see the same figures.
  const view = buildStudentResults(sittings, rules);

  const semesters: MenteeSemesterResult[] = view.semesters.map((sem) => {
    const finals = finalSubjectsOfSemester(sittings, sem.semester);
    const pointsOf = (code: string) => finals.find((f) => f.subjectCode.trim().toUpperCase() === code.trim().toUpperCase())?.points ?? 0;
    const own = sittings.find((x) => x.semester === sem.semester && x.examType !== "REVALUATION");
    return {
      semester: sem.semester,
      year: sem.year,
      academicYear: own?.academicYear ?? "",
      subjects: sem.subjects.map((s) => ({
        code: s.subjectCode,
        name: s.subjectName,
        credits: s.credits,
        grade: s.grade,
        points: pointsOf(s.subjectCode),
        isPass: s.isPass,
        earlier: s.attempts.slice(0, -1).map((a) => ({ examType: a.examType, grade: a.grade })),
      })),
      sgpa: sem.sgpa,
      sgpaWithheld: sem.sgpaWithheld,
      cgpa: sem.cgpa,
      cgpaWithheld: sem.cgpaWithheld,
      backlogs: sem.backlogs,
    };
  });
  return { semesters, backlogs: [...new Set(view.backlogs.map((b) => b.subjectCode))], decimals: rules.decimals };
}

// ── Internal exam marks ──────────────────────────────────────────────────────

export interface MenteeInternalSubject {
  subjectCode: string;
  subjectName: string;
  year: number | null;
  sectionName: string;
  facultyName: string;
  /** Active components in the Exam Cell's order, with this student's mark (null = not entered). */
  components: { id: string; name: string; maxMarks: number | null; marks: number | null }[];
  total: number | null;
  maxTotal: number | null;
}

export interface MenteeInternalMarks {
  subjects: MenteeInternalSubject[];
}

export async function loadMenteeInternalMarks(
  db: Firestore,
  collegeId: string,
  student: StudentRecord & { id: string }
): Promise<MenteeInternalMarks> {
  const collegeRef = db.collection("colleges").doc(collegeId);

  // Every (department, section, year) the student has been filed under, now and
  // in earlier years - a mark sheet is kept against the section it was taken in.
  const places = new Map<string, { department: string; section: string }>();
  const addPlace = (department?: string, section?: string) => {
    if (department && section) places.set(`${department}\u0000${section}`, { department, section });
  };
  addPlace(student.department, student.section);
  addPlace(student.secondaryDepartment ?? undefined, student.section);
  try {
    const hist = await collegeRef.collection("students").doc(student.id).collection("departmentHistory").get();
    for (const d of hist.docs) {
      const h = d.data() as { department?: string; section?: string };
      addPlace(h.department, h.section);
    }
  } catch (err) {
    console.error("[mentoring/internalMarks departmentHistory]", err);
  }

  const seen = new Set<string>();
  const batches: InternalExamMarksBatch[] = [];
  const snaps = await Promise.all(
    [...places.values()].map((p) =>
      collegeRef.collection("internalExamMarks").where("department", "==", p.department).where("sectionName", "==", p.section).get()
    )
  );
  for (const s of snaps) {
    for (const d of s.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const b = { id: d.id, ...d.data() } as InternalExamMarksBatch;
      // Submitted marks only - a draft is still the faculty's own work in progress.
      if (b.status !== "SUBMITTED") continue;
      if (!(b.entries ?? []).some((e) => e.studentId === student.id)) continue;
      batches.push(b);
    }
  }

  const configByBatch = new Map<string, ExamConfiguration | null>();
  await Promise.all(
    batches.map(async (b) => {
      try {
        const r = await resolveExamConfigForBatch(db, collegeRef, b);
        configByBatch.set(b.id, r?.config ?? null);
      } catch (err) {
        console.error("[mentoring/internalMarks config]", err);
        configByBatch.set(b.id, null);
      }
    })
  );

  const subjects: MenteeInternalSubject[] = batches.map((b) => {
    const entry = (b.entries ?? []).find((e) => e.studentId === student.id)!;
    const config = configByBatch.get(b.id) ?? null;
    const configured = config
      ? [...config.components].filter((c) => c.isActive).sort((a, c) => a.order - c.order)
      : [];
    const components = configured.length > 0
      ? configured.map((c) => ({ id: c.id, name: c.name, maxMarks: c.maxMarks, marks: entry.componentMarks?.[c.id] ?? null }))
      : Object.entries(entry.componentMarks ?? {}).map(([id, marks]) => ({ id, name: id, maxMarks: null, marks: marks ?? null }));
    const entered = components.filter((c) => c.marks != null);
    return {
      subjectCode: b.subjectCode,
      subjectName: b.subjectName,
      year: b.year ?? null,
      sectionName: b.sectionName,
      facultyName: b.facultyName,
      components,
      total: entered.length > 0 ? entered.reduce((n, c) => n + (c.marks as number), 0) : null,
      maxTotal: components.every((c) => c.maxMarks != null) && components.length > 0
        ? components.reduce((n, c) => n + (c.maxMarks as number), 0)
        : null,
    };
  });
  subjects.sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.subjectName.localeCompare(b.subjectName));
  return { subjects };
}
