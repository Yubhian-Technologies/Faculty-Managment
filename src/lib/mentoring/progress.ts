import type { Firestore } from "firebase-admin/firestore";
import { loadEffectiveTiming } from "@/lib/college/semester";
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
import { latestPerSubject, studentStanding, type StudentSitting } from "@/lib/examResults/gpa";
import { loadResultRules, recordsCol } from "@/lib/examResults/store";
import { resolveExamConfigForBatch } from "@/lib/exams/internalExamMarks";
import type { CourseYearTiming, ExamConfiguration, InternalExamMarksBatch, StudentRecord } from "@/types";
import type { ExamResultRecord, ExamResultSubject } from "@/types/examResults";

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

export async function loadMenteeAttendance(
  db: Firestore,
  collegeId: string,
  student: StudentRecord & { id: string },
  semesterParam: number | null
): Promise<MenteeAttendance> {
  let semesters: SemesterRange[] = [];
  if (student.courseId && student.year >= 1) {
    const courseId = student.courseId;
    const timings = await Promise.all(
      Array.from({ length: student.year }, (_, i) => i + 1).map(async (year): Promise<YearTiming | null> => {
        const timing: CourseYearTiming | null = await loadEffectiveTiming(db, collegeId, courseId, year);
        if (!timing?.semesters?.length) return null;
        return {
          year,
          semesters: timing.semesters.map((s) => ({
            semester: s.semester,
            startDate: toDateStr(s.startDate),
            endDate: toDateStr(s.endDate),
          })),
        };
      })
    );
    semesters = semesterOptionsForStudent(timings.filter((t): t is YearTiming => t !== null), student.year, istDateKey(new Date()));
  }

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
  const [{ rules }, snap] = await Promise.all([
    loadResultRules(db, collegeId),
    recordsCol(db, collegeId).where("studentId", "==", studentId).get(),
  ]);

  type Rec = ExamResultRecord & { createdAt?: { toMillis?: () => number } };
  const records = snap.docs
    .map((d) => ({ ...(d.data() as Rec), id: d.id }))
    // Only what the Exam Cell has published - drafts are theirs alone.
    .filter((r) => r.status === "PUBLISHED");

  const sittings: StudentSitting[] = records.map((r) => ({
    semester: r.semester,
    examType: r.examType,
    at: r.createdAt?.toMillis?.() ?? 0,
    subjects: r.subjects ?? [],
  }));

  const semesterNumbers = [...new Set(records.map((r) => r.semester))].sort((a, b) => a - b);
  const order = (examType: string) => (examType === "REGULAR" ? 0 : 1);

  const semesters: MenteeSemesterResult[] = semesterNumbers.map((semester) => {
    const own = records
      .filter((r) => r.semester === semester)
      .sort((a, b) => order(a.examType) - order(b.examType) || (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
    const merged = latestPerSubject(own.map((r) => r.subjects ?? []));
    const attemptsByCode = new Map<string, { examType: string; grade: string }[]>();
    for (const r of own) {
      for (const s of r.subjects ?? []) {
        attemptsByCode.set(s.subjectCode, [...(attemptsByCode.get(s.subjectCode) ?? []), { examType: r.examType, grade: s.grade }]);
      }
    }
    const standing = studentStanding(sittings, semester, rules);
    return {
      semester,
      year: own[0]?.year ?? 0,
      academicYear: own[0]?.academicYear ?? "",
      subjects: merged.map((s: ExamResultSubject) => ({
        code: s.subjectCode,
        name: s.subjectName,
        credits: s.credits,
        grade: s.grade,
        points: s.points,
        isPass: s.isPass,
        earlier: (attemptsByCode.get(s.subjectCode) ?? []).slice(0, -1),
      })),
      sgpa: standing.sgpa,
      sgpaWithheld: standing.sgpaWithheld,
      cgpa: standing.cgpa,
      cgpaWithheld: standing.cgpaWithheld,
      backlogs: standing.semesterBacklogs,
    };
  });

  const last = semesterNumbers[semesterNumbers.length - 1];
  const overall = last != null ? studentStanding(sittings, last, rules) : null;
  return { semesters, backlogs: overall?.backlogs ?? [], decimals: rules.decimals };
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
