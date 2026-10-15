// Statistics for a class's semester results - what the Results Analysis page
// shows to the Exam Cell, Principal / Vice Principal and HODs. Pure: the API
// hands in the PUBLISHED records of one course + batch + semester (one branch
// or several) and the college's Result Rules.
//
// "Regular" figures read each student's Regular sheet as published (before any
// revaluation or supplementary); "now" figures read each subject's final result
// (gpa.ts: best of a revaluation, latest pass) - so the gap between the two is
// what supplementaries and revaluations recovered.

import type { ExamResultRecord, ExamResultRules, GradeRule } from "@/types/examResults";
import { applyRevaluations, finalPerSubject, orderSittings, studentStanding, type GpaSubject, type StudentSitting } from "./gpa";

export interface AnalyticsRecord extends Pick<ExamResultRecord,
  "batchId" | "studentId" | "rollNumber" | "name" | "semester" | "academicYear" | "examHeld" | "examType" | "revaluesBatchId" | "subjects"> {
  /** The sheet's branch (the batch's department - not the student's own, which for a 1st year can be Basic Science). */
  branch: string;
  /** Import time (ms). */
  at: number;
}

export interface SubjectStat {
  subjectCode: string;
  subjectName: string;
  credits: number;
  appeared: number;
  passedRegular: number;
  passedNow: number;
  /** Final grade -> students. */
  grades: Record<string, number>;
  /** Mean final grade points (a fail counts 0). */
  averagePoints: number;
}

export interface BranchStat {
  branch: string;
  appeared: number;
  passedRegular: number;
  passedNow: number;
  averageSgpa: number | null;
}

export interface StudentRow {
  studentId: string;
  rollNumber: string;
  name: string;
  branch: string;
  sgpa: number | null;
  backlogs: { subjectCode: string; subjectName: string }[];
}

export interface ResultsAnalytics {
  appeared: number;
  /** Passed every subject in the Regular exam. */
  passedRegular: number;
  /** Has no backlog of this semester now. */
  passedNow: number;
  averageSgpa: number | null;
  highestSgpa: number | null;
  /** Students the show rules give an SGPA to (the average and toppers use only these). */
  withSgpa: number;
  backlogSubjects: number;
  studentsWithBacklogs: number;
  /** Final grades over every subject result, in grade-table order (best first). */
  grades: { grade: string; count: number; isPass: boolean }[];
  sgpaBands: { label: string; count: number }[];
  subjects: SubjectStat[];
  branches: BranchStat[];
  toppers: StudentRow[];
  backlogStudents: StudentRow[];
  decimals: number;
}

const BANDS: { label: string; min: number; max: number }[] = [
  { label: "9 - 10", min: 9, max: Infinity },
  { label: "8 - 9", min: 8, max: 9 },
  { label: "7 - 8", min: 7, max: 8 },
  { label: "6 - 7", min: 6, max: 7 },
  { label: "Below 6", min: -Infinity, max: 6 },
];

const key = (code: string) => code.trim().toUpperCase();
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function buildResultsAnalytics(
  records: AnalyticsRecord[],
  rules: Pick<ExamResultRules, "showSgpa" | "showCgpa" | "decimals">,
  gradeTable: GradeRule[] = [],
  semester: number = records[0]?.semester ?? 0
): ResultsAnalytics {
  const byStudent = new Map<string, AnalyticsRecord[]>();
  for (const r of records) byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), r]);

  const subjectStats = new Map<string, SubjectStat & { pointsSum: number }>();
  const branchStats = new Map<string, BranchStat & { sgpaSum: number; sgpaCount: number }>();
  const students: StudentRow[] = [];
  const gradeCounts = new Map<string, { count: number; isPass: boolean }>();
  let passedRegular = 0;
  let passedNow = 0;

  for (const list of byStudent.values()) {
    const regular = orderSittings(list.filter((r) => r.examType === "REGULAR")).pop();
    // Only students who sat the Regular exam of this class are counted.
    if (!regular) continue;
    const sittings: StudentSitting[] = list.map((r) => ({
      semester: r.semester, academicYear: r.academicYear, examHeld: r.examHeld, examType: r.examType, batchId: r.batchId,
      ...(r.revaluesBatchId ? { revaluesBatchId: r.revaluesBatchId } : {}), at: r.at, subjects: r.subjects,
    }));
    const finals = finalPerSubject(orderSittings(applyRevaluations(sittings)).map((s) => s.subjects)) as (GpaSubject & { subjectName?: string; grade?: string })[];
    const finalByCode = new Map(finals.map((s) => [key(s.subjectCode), s]));
    const standing = studentStanding(sittings, semester, rules);
    const branch = regular.branch;

    const regularAllPass = regular.subjects.every((s) => s.isPass);
    const backlogs = finals.filter((s) => !s.isPass);
    if (regularAllPass) passedRegular++;
    if (backlogs.length === 0) passedNow++;

    for (const s of regular.subjects) {
      const k = key(s.subjectCode);
      const final = finalByCode.get(k) ?? s;
      const stat = subjectStats.get(k) ?? { subjectCode: s.subjectCode, subjectName: s.subjectName, credits: s.credits, appeared: 0, passedRegular: 0, passedNow: 0, grades: {}, averagePoints: 0, pointsSum: 0 };
      stat.appeared++;
      if (s.isPass) stat.passedRegular++;
      if (final.isPass) stat.passedNow++;
      const g = (final as { grade?: string }).grade ?? s.grade;
      stat.grades[g] = (stat.grades[g] ?? 0) + 1;
      stat.pointsSum += final.isPass ? final.points : 0;
      subjectStats.set(k, stat);
      // Zero-credit subjects are Pass / Fail only - not part of the letter-grade chart.
      if (s.credits > 0) {
        const gc = gradeCounts.get(g) ?? { count: 0, isPass: final.isPass };
        gc.count++;
        gradeCounts.set(g, gc);
      }
    }

    const b = branchStats.get(branch) ?? { branch, appeared: 0, passedRegular: 0, passedNow: 0, averageSgpa: null, sgpaSum: 0, sgpaCount: 0 };
    b.appeared++;
    if (regularAllPass) b.passedRegular++;
    if (backlogs.length === 0) b.passedNow++;
    if (standing.sgpa != null) { b.sgpaSum += standing.sgpa; b.sgpaCount++; }
    branchStats.set(branch, b);

    students.push({
      studentId: regular.studentId, rollNumber: regular.rollNumber, name: regular.name, branch, sgpa: standing.sgpa,
      backlogs: backlogs.map((s) => ({ subjectCode: s.subjectCode, subjectName: (s as { subjectName?: string }).subjectName ?? s.subjectCode })),
    });
  }

  const d = rules.decimals;
  const withSgpa = students.filter((s) => s.sgpa != null);
  const sgpaValues = withSgpa.map((s) => s.sgpa as number);
  const order = new Map(gradeTable.map((g, i) => [g.grade.toUpperCase(), i]));
  const grades = [...gradeCounts.entries()]
    .map(([grade, v]) => ({ grade, count: v.count, isPass: v.isPass }))
    .sort((a, b) => (order.get(a.grade.toUpperCase()) ?? 99) - (order.get(b.grade.toUpperCase()) ?? 99) || a.grade.localeCompare(b.grade));

  return {
    appeared: students.length,
    passedRegular,
    passedNow,
    averageSgpa: sgpaValues.length ? round(sgpaValues.reduce((a, b) => a + b, 0) / sgpaValues.length, d) : null,
    highestSgpa: sgpaValues.length ? Math.max(...sgpaValues) : null,
    withSgpa: withSgpa.length,
    backlogSubjects: students.reduce((n, s) => n + s.backlogs.length, 0),
    studentsWithBacklogs: students.filter((s) => s.backlogs.length > 0).length,
    grades,
    sgpaBands: [
      ...BANDS.map((band) => ({ label: band.label, count: sgpaValues.filter((v) => v >= band.min && v < band.max).length })),
      { label: "Withheld", count: students.length - withSgpa.length },
    ],
    subjects: [...subjectStats.values()].map(({ pointsSum, ...s }) => ({ ...s, averagePoints: s.appeared ? round(pointsSum / s.appeared, 2) : 0 })),
    branches: [...branchStats.values()]
      .map(({ sgpaSum, sgpaCount, ...b }) => ({ ...b, averageSgpa: sgpaCount ? round(sgpaSum / sgpaCount, d) : null }))
      .sort((a, b) => a.branch.localeCompare(b.branch)),
    toppers: [...withSgpa].sort((a, b) => (b.sgpa as number) - (a.sgpa as number) || a.rollNumber.localeCompare(b.rollNumber)).slice(0, 10),
    backlogStudents: students.filter((s) => s.backlogs.length > 0).sort((a, b) => b.backlogs.length - a.backlogs.length || a.rollNumber.localeCompare(b.rollNumber)),
    decimals: d,
  };
}

/** One exam of a class across its branch sheets: "REGULAR||2025-11", "REVALUATION|SUPPLEMENTARY|2026-05". */
export function examKeyOf(r: Pick<AnalyticsRecord, "examType" | "examHeld"> & { revaluationOf?: string }): string {
  return `${r.examType}|${r.examType === "REVALUATION" ? r.revaluationOf ?? "" : ""}|${r.examHeld ?? ""}`;
}

export interface ExamAnalytics extends ResultsAnalytics {
  /** REVALUATION only: subject results whose revaluation grade beat the original, and how many were revalued. */
  improved?: number;
  revalued?: number;
}

/**
 * Statistics of ONE exam (its records across the class's branch sheets):
 *   passedRegular = students who passed every subject they wrote in it,
 *   passedNow     = students with no backlog of the semester now,
 *   grades / subjects / backlogs = that exam's own grades,
 *   SGPA          = each student's standing right after that exam.
 * `records` is every record of the class (for standings and the revaluation's originals).
 */
export function buildExamAnalytics(
  records: (AnalyticsRecord & { revaluationOf?: string })[],
  examKey: string,
  rules: Pick<ExamResultRules, "showSgpa" | "showCgpa" | "decimals">,
  gradeTable: GradeRule[] = [],
  semester: number = records[0]?.semester ?? 0
): ExamAnalytics {
  const inExam = records.filter((r) => examKeyOf(r) === examKey);
  const byStudent = new Map<string, (AnalyticsRecord & { revaluationOf?: string })[]>();
  for (const r of records) byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), r]);
  const toSitting = (r: AnalyticsRecord): StudentSitting => ({
    semester: r.semester, academicYear: r.academicYear, examHeld: r.examHeld, examType: r.examType, batchId: r.batchId,
    ...(r.revaluesBatchId ? { revaluesBatchId: r.revaluesBatchId } : {}), at: r.at, subjects: r.subjects,
  });

  const subjectStats = new Map<string, SubjectStat & { pointsSum: number }>();
  const branchStats = new Map<string, BranchStat & { sgpaSum: number; sgpaCount: number }>();
  const gradeCounts = new Map<string, { count: number; isPass: boolean }>();
  const students: StudentRow[] = [];
  let passedExam = 0;
  let passedNow = 0;
  let improved = 0;
  let revalued = 0;

  for (const exam of inExam) {
    const all = byStudent.get(exam.studentId) ?? [];
    // Everything up to and including this exam, for the standing "right after" it.
    const ordered = orderSittings(all.map((r) => ({ ...toSitting(r), _rec: r })));
    const upto = ordered.slice(0, ordered.findIndex((s) => s._rec === exam) + 1);
    const after = studentStanding(upto, semester, rules);
    const finals = finalPerSubject(orderSittings(applyRevaluations(all.map(toSitting))).map((s) => s.subjects));
    const noBacklog = finals.every((s) => s.isPass);
    const passedAll = exam.subjects.every((s) => s.isPass);
    if (passedAll) passedExam++;
    if (noBacklog) passedNow++;

    // A revaluation's original grades: the sheet it re-grades.
    const original = exam.examType === "REVALUATION" ? all.find((r) => r.batchId === exam.revaluesBatchId) : undefined;
    const finalByCode = new Map(finals.map((s) => [key(s.subjectCode), s]));
    for (const s of exam.subjects) {
      const k = key(s.subjectCode);
      const stat = subjectStats.get(k) ?? { subjectCode: s.subjectCode, subjectName: s.subjectName, credits: s.credits, appeared: 0, passedRegular: 0, passedNow: 0, grades: {}, averagePoints: 0, pointsSum: 0 };
      stat.appeared++;
      if (s.isPass) stat.passedRegular++;
      if ((finalByCode.get(k) ?? s).isPass) stat.passedNow++;
      stat.grades[s.grade] = (stat.grades[s.grade] ?? 0) + 1;
      stat.pointsSum += s.isPass ? s.points : 0;
      subjectStats.set(k, stat);
      if (s.credits > 0) {
        const gc = gradeCounts.get(s.grade) ?? { count: 0, isPass: s.isPass };
        gc.count++;
        gradeCounts.set(s.grade, gc);
      }
      if (original) {
        revalued++;
        const before = original.subjects.find((x) => key(x.subjectCode) === k);
        if (before && (s.isPass !== before.isPass ? s.isPass : s.points > before.points)) improved++;
      }
    }

    const b = branchStats.get(exam.branch) ?? { branch: exam.branch, appeared: 0, passedRegular: 0, passedNow: 0, averageSgpa: null, sgpaSum: 0, sgpaCount: 0 };
    b.appeared++;
    if (passedAll) b.passedRegular++;
    if (noBacklog) b.passedNow++;
    if (after.sgpa != null) { b.sgpaSum += after.sgpa; b.sgpaCount++; }
    branchStats.set(exam.branch, b);

    const failed = exam.subjects.filter((s) => !s.isPass);
    students.push({
      studentId: exam.studentId, rollNumber: exam.rollNumber, name: exam.name, branch: exam.branch, sgpa: after.sgpa,
      backlogs: failed.map((s) => ({ subjectCode: s.subjectCode, subjectName: s.subjectName })),
    });
  }

  const d = rules.decimals;
  const withSgpa = students.filter((s) => s.sgpa != null);
  const sgpaValues = withSgpa.map((s) => s.sgpa as number);
  const order = new Map(gradeTable.map((g, i) => [g.grade.toUpperCase(), i]));
  return {
    appeared: students.length,
    passedRegular: passedExam,
    passedNow,
    averageSgpa: sgpaValues.length ? round(sgpaValues.reduce((x, y) => x + y, 0) / sgpaValues.length, d) : null,
    highestSgpa: sgpaValues.length ? Math.max(...sgpaValues) : null,
    withSgpa: withSgpa.length,
    backlogSubjects: students.reduce((n, s) => n + s.backlogs.length, 0),
    studentsWithBacklogs: students.filter((s) => s.backlogs.length > 0).length,
    grades: [...gradeCounts.entries()].map(([grade, v]) => ({ grade, count: v.count, isPass: v.isPass }))
      .sort((x, y) => (order.get(x.grade.toUpperCase()) ?? 99) - (order.get(y.grade.toUpperCase()) ?? 99) || x.grade.localeCompare(y.grade)),
    sgpaBands: [
      ...BANDS.map((band) => ({ label: band.label, count: sgpaValues.filter((v) => v >= band.min && v < band.max).length })),
      { label: "Withheld", count: students.length - withSgpa.length },
    ],
    subjects: [...subjectStats.values()].map(({ pointsSum, ...s }) => ({ ...s, averagePoints: s.appeared ? round(pointsSum / s.appeared, 2) : 0 })),
    branches: [...branchStats.values()].map(({ sgpaSum, sgpaCount, ...b }) => ({ ...b, averageSgpa: sgpaCount ? round(sgpaSum / sgpaCount, d) : null }))
      .sort((x, y) => x.branch.localeCompare(y.branch)),
    toppers: [...withSgpa].sort((x, y) => (y.sgpa as number) - (x.sgpa as number) || x.rollNumber.localeCompare(y.rollNumber)).slice(0, 10),
    backlogStudents: students.filter((s) => s.backlogs.length > 0).sort((x, y) => y.backlogs.length - x.backlogs.length || x.rollNumber.localeCompare(y.rollNumber)),
    decimals: d,
    ...(inExam.some((r) => r.examType === "REVALUATION") ? { improved, revalued } : {}),
  };
}
