import type { Firestore } from "firebase-admin/firestore";
import type { StudentAttendanceSession } from "@/types";
import { indexSessions, tallyStudentBySubject } from "./counting";
import { calcPercent } from "./percentage";

interface SubjectTally {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  held: number;
  attended: number;
}

export interface AttendanceHistoryRange {
  from?: string | null; // yyyy-mm-dd inclusive
  to?: string | null;
  year?: string | null; // yyyy
  month?: string | null; // 1-12, not necessarily zero-padded
}

export interface StudentAttendanceSubjectRow {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  /** Subject.shortCode ("CHE") when one is set; the callers display shortCode || subjectCode. */
  shortCode?: string;
  held: number;
  attend: number;
  percent: number;
}

export interface StudentAttendanceHistory {
  subjects: StudentAttendanceSubjectRow[];
  total: { held: number; attend: number; percent: number };
}

// Firestore caps an `in` filter at 30 values.
const MAX_DEPARTMENTS = 30;

/**
 * Every department a student's sessions can be filed under: the one they are in
 * now, their shared-first-year branch (secondaryDepartment), and every
 * department they were ever in (students/{id}/departmentHistory, written on
 * create and on every promotion). A session carries the SECTION's department at
 * the time it was marked, so filtering by only the current department silently
 * dropped a promoted student's earlier years.
 */
export async function studentDepartmentsForHistory(
  db: Firestore,
  collegeId: string,
  student: { id: string; department: string; secondaryDepartment?: string | null }
): Promise<string[]> {
  const out = new Set<string>();
  if (student.department) out.add(student.department);
  if (student.secondaryDepartment) out.add(student.secondaryDepartment);
  try {
    const hist = await db
      .collection("colleges").doc(collegeId)
      .collection("students").doc(student.id)
      .collection("departmentHistory")
      .get();
    for (const d of hist.docs) {
      const dept = (d.data() as { department?: string }).department;
      if (dept) out.add(dept);
    }
  } catch (err) {
    // History is a widening, never a requirement - the current departments
    // above still give the same result as before this lookup existed.
    console.error("[studentAttendance/history departmentHistory]", err);
  }
  return Array.from(out).slice(0, MAX_DEPARTMENTS);
}

// Cumulative per-subject Held/Attend/% for ONE student across a caller-chosen
// date range (or unbounded, "till now", when `range` is empty) - extracted out
// of api/college/student-attendance-history/route.ts (HOD/Principal/VP report)
// so api/college/student/me (a student's own self-view) can compute the exact
// same numbers without duplicating the scan/dedupe logic. Scans every SUBMITTED
// session filed under one of the student's departments, and counts only the
// ones that actually list this student in `entries` (see counting.ts - the one
// definition of held/attended every report shares).
export async function computeStudentAttendanceHistory(
  db: Firestore,
  collegeId: string,
  studentId: string,
  departments: string | string[],
  range: AttendanceHistoryRange = {}
): Promise<StudentAttendanceHistory> {
  const monthStr = range.month ? String(Number(range.month)).padStart(2, "0") : null;

  // Push the date range into the query (status+department+date index) instead
  // of reading the department's whole history and filtering in memory.
  let lower = range.from ?? null;
  let upper = range.to ?? null;
  if (range.year && /^\d{4}$/.test(range.year)) {
    const yLo = monthStr ? `${range.year}-${monthStr}-01` : `${range.year}-01-01`;
    const yHi = monthStr ? `${range.year}-${monthStr}-31` : `${range.year}-12-31`;
    lower = lower && lower > yLo ? lower : yLo;
    upper = upper && upper < yHi ? upper : yHi;
  }

  const depts = (Array.isArray(departments) ? departments : [departments]).filter(Boolean).slice(0, MAX_DEPARTMENTS);
  if (depts.length === 0) return { subjects: [], total: { held: 0, attend: 0, percent: 0 } };

  let query: FirebaseFirestore.Query = db
    .collection("colleges")
    .doc(collegeId)
    .collection("studentAttendance")
    .where("department", depts.length === 1 ? "==" : "in", depts.length === 1 ? depts[0] : depts)
    .where("status", "==", "SUBMITTED");
  if (lower) query = query.where("date", ">=", lower);
  if (upper) query = query.where("date", "<=", upper);
  const sessionsSnap = await query.get();

  const inRange = sessionsSnap.docs
    .map((d) => d.data() as StudentAttendanceSession)
    .filter((r) => {
      if (range.year && r.date.slice(0, 4) !== range.year) return false;
      if (monthStr && r.date.slice(5, 7) !== monthStr) return false;
      if (range.from && r.date < range.from) return false;
      if (range.to && r.date > range.to) return false;
      return true;
    });

  // Every submitted session is one period and counts for a student who is on
  // its roster. Collapsing to one session per subject per day made a 3-period
  // lab block count once.
  const tally = tallyStudentBySubject(indexSessions(inRange), studentId);
  const names = new Map<string, { subjectName: string; subjectCode: string }>();
  for (const r of inRange) {
    if (tally.has(r.subjectId) && !names.has(r.subjectId)) {
      names.set(r.subjectId, { subjectName: r.subjectName, subjectCode: r.subjectCode });
    }
  }
  return assemble(
    db,
    collegeId,
    Array.from(tally.entries()).map(([subjectId, v]) => ({
      subjectId,
      subjectName: names.get(subjectId)?.subjectName ?? "",
      subjectCode: names.get(subjectId)?.subjectCode ?? "",
      held: v.held,
      attended: v.attended,
    }))
  );
}

// Turns per-subject tallies (from the scan or the rollup - same shape) into the
// rows every caller gets: short codes joined, % computed, sorted, with a total.
async function assemble(db: Firestore, collegeId: string, tallies: SubjectTally[]): Promise<StudentAttendanceHistory> {
  const shortCodes = await loadShortCodes(db, collegeId, tallies.map((t) => t.subjectId));

  const subjects: StudentAttendanceSubjectRow[] = tallies
    .map((t) => ({
      subjectId: t.subjectId,
      subjectName: t.subjectName,
      subjectCode: t.subjectCode,
      ...(shortCodes.get(t.subjectId) ? { shortCode: shortCodes.get(t.subjectId) } : {}),
      held: t.held,
      attend: t.attended,
      percent: calcPercent(t.attended, t.held) ?? 0,
    }))
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName));

  const totalHeld = subjects.reduce((a, s) => a + s.held, 0);
  const totalAttend = subjects.reduce((a, s) => a + s.attend, 0);

  return {
    subjects,
    total: { held: totalHeld, attend: totalAttend, percent: calcPercent(totalAttend, totalHeld) ?? 0 },
  };
}

// Sessions only snapshot subjectName/subjectCode, so the mnemonic short code
// ("CHE") is joined from the Subject doc at read time. A subject without one
// (or one that has since been deleted) simply has no entry - callers fall back
// to subjectCode.
async function loadShortCodes(db: Firestore, collegeId: string, subjectIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (subjectIds.length === 0) return out;
  try {
    const col = db.collection("colleges").doc(collegeId).collection("subjects");
    const snaps = await db.getAll(...subjectIds.map((id) => col.doc(id)));
    for (const s of snaps) {
      const code = (s.data() as { shortCode?: string } | undefined)?.shortCode?.trim();
      if (s.exists && code) out.set(s.id, code);
    }
  } catch (err) {
    console.error("[studentAttendance/history shortCodes]", err);
  }
  return out;
}
