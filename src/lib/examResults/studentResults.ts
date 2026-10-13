// A student's own results, semester by semester - what the student's Results
// page shows. Pure: the API hands in the student's PUBLISHED sittings and the
// college's Result Rules.
//
// Within a semester each subject's result is its final one (gpa.ts): a
// revaluation counts only if it is better than the grade it re-grades (best
// of two), and the latest PASSING attempt wins over a later fail. Every
// attempt - Regular, Supplementary, Revaluation - is kept as history. SGPA /
// CGPA follow the college's show rules through studentStanding, so a
// withheld figure stays withheld here too.

import type { ExamResultRules, ExamResultSubject, ExamResultType, RevaluableExamType } from "@/types/examResults";
import { applyRevaluations, betterResult, finalPerSubject, orderSittings, studentStanding, type StudentSitting } from "./gpa";

export interface StudentResultSitting {
  semester: number;
  year: number;
  academicYear: string;
  /** "2026-11". */
  examHeld?: string;
  examType: ExamResultType;
  batchId: string;
  /** REVALUATION only. */
  revaluationOf?: RevaluableExamType;
  revaluesBatchId?: string;
  /** Import time (ms). */
  at: number;
  subjects: ExamResultSubject[];
}

export interface StudentAttempt {
  academicYear: string;
  /** "2026-11" - shown as "Nov 2026". */
  examHeld?: string;
  examType: ExamResultType;
  /** REVALUATION only: the exam re-graded, and whether its grade replaced the original. */
  revaluationOf?: RevaluableExamType;
  improved?: boolean;
  grade: string;
  isPass: boolean;
}

export interface StudentSubjectResult {
  subjectCode: string;
  subjectName: string;
  credits: number;
  grade: string;
  isPass: boolean;
  /** Every sitting of the subject, oldest first (a revaluation right after the sitting it re-grades). */
  attempts: StudentAttempt[];
}

export interface StudentSemesterResult {
  semester: number;
  year: number;
  sgpa: number | null;
  sgpaWithheld: boolean;
  cgpa: number | null;
  cgpaWithheld: boolean;
  /** Credits of the semester's subjects (what SGPA divides by). */
  credits: number;
  subjects: StudentSubjectResult[];
  /** Subject codes of this semester not passed yet. */
  backlogs: string[];
}

export interface StudentResultsView {
  semesters: StudentSemesterResult[];
  /** CGPA over every semester with results. */
  cgpa: number | null;
  cgpaWithheld: boolean;
  /** Credits of the subjects passed so far. */
  creditsEarned: number;
  backlogs: { semester: number; subjectCode: string; subjectName: string }[];
  decimals: number;
}

const key = (code: string) => code.trim().toUpperCase();

export function buildStudentResults(sittings: StudentResultSitting[], rules: Pick<ExamResultRules, "showSgpa" | "showCgpa" | "decimals">): StudentResultsView {
  const ordered = orderSittings(sittings);
  const asGpa = (s: StudentResultSitting): StudentSitting & { source: StudentResultSitting } => ({
    semester: s.semester, academicYear: s.academicYear, examHeld: s.examHeld, examType: s.examType, batchId: s.batchId,
    ...(s.revaluesBatchId ? { revaluesBatchId: s.revaluesBatchId } : {}), at: s.at, subjects: s.subjects, source: s,
  });
  const gpaSittings = ordered.map(asGpa);
  const resolved = applyRevaluations(gpaSittings);

  const semesterNumbers = [...new Set(ordered.map((s) => s.semester))].sort((a, b) => a - b);
  const semesters: StudentSemesterResult[] = semesterNumbers.map((semester) => {
    const sittingsOfSem = ordered.filter((s) => s.semester === semester && s.examType !== "REVALUATION");
    // Each subject's final result (best of revaluation, latest pass).
    const finals = new Map(finalPerSubject(orderSittings(resolved.filter((s) => s.semester === semester)).map((s) => s.subjects as ExamResultSubject[]))
      .map((s) => [key(s.subjectCode), s]));

    // History, in the order the subjects first appeared; a revaluation follows its sitting.
    const bySubject = new Map<string, StudentSubjectResult>();
    for (const sitting of sittingsOfSem) {
      const revals = ordered.filter((r) => r.examType === "REVALUATION" && r.revaluesBatchId === sitting.batchId);
      for (const sub of sitting.subjects) {
        const k = key(sub.subjectCode);
        const entry = bySubject.get(k) ?? { subjectCode: sub.subjectCode, subjectName: sub.subjectName, credits: sub.credits, grade: sub.grade, isPass: sub.isPass, attempts: [] };
        entry.attempts.push({ academicYear: sitting.academicYear, ...(sitting.examHeld ? { examHeld: sitting.examHeld } : {}), examType: sitting.examType, grade: sub.grade, isPass: sub.isPass });
        let best: ExamResultSubject = sub;
        for (const r of revals) {
          const re = r.subjects.find((x) => key(x.subjectCode) === k);
          if (!re) continue;
          const next = betterResult(best, re);
          entry.attempts.push({ academicYear: r.academicYear, ...(r.examHeld ? { examHeld: r.examHeld } : {}), examType: "REVALUATION", revaluationOf: r.revaluationOf, improved: next === re, grade: re.grade, isPass: re.isPass });
          best = next;
        }
        bySubject.set(k, entry);
      }
    }
    for (const [k, entry] of bySubject) {
      const f = finals.get(k);
      if (f) Object.assign(entry, { subjectName: f.subjectName, credits: f.credits, grade: f.grade, isPass: f.isPass });
    }
    const subjects = [...bySubject.values()];
    const standing = studentStanding(gpaSittings, semester, rules);
    const last = sittingsOfSem[sittingsOfSem.length - 1] ?? ordered.find((s) => s.semester === semester)!;
    return {
      semester,
      year: last.year,
      sgpa: standing.sgpa,
      sgpaWithheld: standing.sgpaWithheld,
      cgpa: standing.cgpa,
      cgpaWithheld: standing.cgpaWithheld,
      credits: subjects.filter((s) => s.credits > 0).reduce((n, s) => n + s.credits, 0),
      subjects,
      backlogs: subjects.filter((s) => !s.isPass).map((s) => s.subjectCode),
    };
  }).filter((s) => s.subjects.length > 0);

  const last = semesters[semesters.length - 1];
  return {
    semesters,
    cgpa: last?.cgpa ?? null,
    cgpaWithheld: last?.cgpaWithheld ?? false,
    creditsEarned: semesters.reduce((n, s) => n + s.subjects.filter((x) => x.isPass && x.credits > 0).reduce((m, x) => m + x.credits, 0), 0),
    backlogs: semesters.flatMap((s) => s.subjects.filter((x) => !x.isPass).map((x) => ({ semester: s.semester, subjectCode: x.subjectCode, subjectName: x.subjectName }))),
    decimals: rules.decimals,
  };
}
