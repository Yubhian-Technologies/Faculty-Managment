import type { Firestore } from "firebase-admin/firestore";
import type { StudentAttendanceSession } from "@/types";

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
  held: number;
  attend: number;
  percent: number;
}

export interface StudentAttendanceHistory {
  subjects: StudentAttendanceSubjectRow[];
  total: { held: number; attend: number; percent: number };
}

// Cumulative per-subject Held/Attend/% for ONE student across a caller-chosen
// date range (or unbounded, "till now", when `range` is empty) - extracted out
// of api/college/student-attendance-history/route.ts (HOD/Principal/VP report)
// so api/college/student/me/route.ts (a student's own self-view) can compute
// the exact same numbers without duplicating the scan/dedupe logic. Scans
// every SUBMITTED session scoped by department, keeping only the ones that
// actually list this student in `entries` - see the HOD-facing route's own
// doc-comment for why department-scoping is a practical narrowing, not the
// real membership check.
export async function computeStudentAttendanceHistory(
  db: Firestore,
  collegeId: string,
  studentId: string,
  department: string,
  range: AttendanceHistoryRange = {}
): Promise<StudentAttendanceHistory> {
  const monthStr = range.month ? String(Number(range.month)).padStart(2, "0") : null;

  // Push the date range into the query (status+department+date index) instead
  // of reading the department's whole history and filtering in memory - this
  // runs on every student dashboard load.
  let lower = range.from ?? null;
  let upper = range.to ?? null;
  if (range.year && /^\d{4}$/.test(range.year)) {
    const yLo = monthStr ? `${range.year}-${monthStr}-01` : `${range.year}-01-01`;
    const yHi = monthStr ? `${range.year}-${monthStr}-31` : `${range.year}-12-31`;
    lower = lower && lower > yLo ? lower : yLo;
    upper = upper && upper < yHi ? upper : yHi;
  }
  let query: FirebaseFirestore.Query = db
    .collection("colleges")
    .doc(collegeId)
    .collection("studentAttendance")
    .where("department", "==", department)
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
    })
    .filter((r) => r.entries.some((e) => e.studentId === studentId));

  // Every submitted session is one period and counts for a student who is on
  // its roster - the same rule every report uses (see counting.ts). Collapsing
  // to one session per subject per day made a 3-period lab block count once.
  const bySubject = new Map<string, { subjectName: string; subjectCode: string; held: number; attend: number }>();
  for (const r of inRange) {
    const entry = r.entries.find((e) => e.studentId === studentId)!;
    const cur = bySubject.get(r.subjectId) ?? { subjectName: r.subjectName, subjectCode: r.subjectCode, held: 0, attend: 0 };
    cur.held += 1;
    if (entry.status === "PRESENT") cur.attend += 1;
    bySubject.set(r.subjectId, cur);
  }

  const subjects = Array.from(bySubject.entries())
    .map(([subjectId, v]) => ({
      subjectId,
      subjectName: v.subjectName,
      subjectCode: v.subjectCode,
      held: v.held,
      attend: v.attend,
      percent: v.held > 0 ? Math.round((v.attend / v.held) * 10000) / 100 : 0,
    }))
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName));

  const totalHeld = subjects.reduce((a, s) => a + s.held, 0);
  const totalAttend = subjects.reduce((a, s) => a + s.attend, 0);

  return {
    subjects,
    total: {
      held: totalHeld,
      attend: totalAttend,
      percent: totalHeld > 0 ? Math.round((totalAttend / totalHeld) * 10000) / 100 : 0,
    },
  };
}
