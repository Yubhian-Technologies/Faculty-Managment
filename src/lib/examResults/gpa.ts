// SGPA and CGPA - the two formulas, the same for every college:
//
//   SGPA = Σ(Ci × Gi) / ΣCi          over the subjects of ONE semester
//          Ci = the subject's credits, Gi = the grade points earned in it
//   CGPA = Σ(semester credits × semester SGPA) / Σ semester credits
//
// ΣCi is the semester's TOTAL credits, so a failed subject stays in the
// divisor with 0 points. What a college chooses (ExamResultRules) is only
// WHEN a figure may be shown: always, or only once everything it covers is
// passed. Nothing here is stored - a figure is worked out from the grades each
// time, which is what makes it appear by itself once a backlog is cleared.
//
// Pure: no Firestore, no clock.

import type { GpaShowRule } from "@/types/examResults";

/** The least a subject result needs for the formulas. */
export interface GpaSubject {
  subjectCode: string;
  credits: number;
  points: number;
  isPass: boolean;
}

export interface SemesterGpa {
  /** Null when withheld (see `withheld`) or when no subject carries credits. */
  sgpa: number | null;
  /** Unrounded, for CGPA - never show this one. */
  exactSgpa: number | null;
  /** Credits the formula divides by: every credit-bearing subject, failed or not. */
  credits: number;
  /** Σ(Ci × Gi). */
  weightedPoints: number;
  /** Subject codes not passed yet. */
  backlogs: string[];
  /** True when the rule holds the figure back because of `backlogs`. */
  withheld: boolean;
}

function round(value: number, decimals: number): number {
  const d = Number.isInteger(decimals) && decimals >= 0 && decimals <= 4 ? decimals : 2;
  const f = 10 ** d;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/**
 * The latest result of each subject: a later sitting (a supplementary exam)
 * replaces an earlier one. `attempts` must be oldest first.
 */
export function latestPerSubject<T extends { subjectCode: string }>(attempts: T[][]): T[] {
  const byCode = new Map<string, T>();
  for (const sitting of attempts) {
    for (const s of sitting) byCode.set(s.subjectCode.trim().toUpperCase(), s);
  }
  return [...byCode.values()];
}

/** One semester's SGPA from that semester's subjects (latest result of each). */
export function computeSgpa(subjects: GpaSubject[], showRule: GpaShowRule, decimals = 2): SemesterGpa {
  // A zero-credit subject (a mandatory / audit course) is no part of the
  // formula, but it still has to be passed.
  const backlogs = subjects.filter((s) => !s.isPass).map((s) => s.subjectCode);
  const counted = subjects.filter((s) => s.credits > 0);
  const credits = counted.reduce((sum, s) => sum + s.credits, 0);
  const weightedPoints = counted.reduce((sum, s) => sum + s.credits * (s.isPass ? s.points : 0), 0);
  const withheld = showRule === "ALL_PASSED" && backlogs.length > 0;
  const exact = credits > 0 && !withheld ? weightedPoints / credits : null;
  return {
    sgpa: exact == null ? null : round(exact, decimals),
    exactSgpa: exact,
    credits,
    weightedPoints,
    backlogs,
    withheld,
  };
}

export interface CumulativeGpa {
  cgpa: number | null;
  credits: number;
  /** Every subject not passed yet, across the semesters given. */
  backlogs: string[];
  withheld: boolean;
}

/**
 * CGPA over the semesters given (each a semester's subjects, latest result of
 * each). Worked out from the exact weighted points rather than the rounded
 * SGPAs, which is the same formula without the rounding error piling up.
 */
export function computeCgpa(semesters: GpaSubject[][], showRule: GpaShowRule, decimals = 2): CumulativeGpa {
  // Each semester is taken in full ("ALWAYS") here - whether the CGPA itself
  // may be shown is this function's own rule, applied once below.
  const parts = semesters.map((s) => computeSgpa(s, "ALWAYS", decimals));
  const credits = parts.reduce((sum, p) => sum + p.credits, 0);
  const weightedPoints = parts.reduce((sum, p) => sum + p.weightedPoints, 0);
  const backlogs = parts.flatMap((p) => p.backlogs);
  const withheld = showRule === "ALL_PASSED" && backlogs.length > 0;
  return {
    cgpa: credits > 0 && !withheld ? round(weightedPoints / credits, decimals) : null,
    credits,
    backlogs,
    withheld,
  };
}

/** One sitting of one semester for a student (a Regular sheet or a Supplementary one). */
export interface StudentSitting {
  semester: number;
  examType: "REGULAR" | "SUPPLEMENTARY";
  /** When the sitting was imported (ms) - orders supplementaries after the regular and each other. */
  at: number;
  subjects: GpaSubject[];
}

export interface StudentStanding {
  sgpa: number | null;
  sgpaWithheld: boolean;
  cgpa: number | null;
  cgpaWithheld: boolean;
  /** Subjects of `semester` not passed yet. */
  semesterBacklogs: string[];
  /** Subjects of every semester up to `semester` not passed yet. */
  backlogs: string[];
}

/**
 * A student's SGPA for `semester` and CGPA over every semester up to and
 * including it, from all their sittings: within a semester a later sitting's
 * grade replaces an earlier one (a supplementary pass clears the backlog).
 */
export function studentStanding(
  sittings: StudentSitting[],
  semester: number,
  rules: { showSgpa: GpaShowRule; showCgpa: GpaShowRule; decimals: number }
): StudentStanding {
  const order = (s: StudentSitting) => (s.examType === "REGULAR" ? 0 : 1);
  const bySemester = new Map<number, StudentSitting[]>();
  for (const s of sittings) {
    if (s.semester > semester) continue;
    bySemester.set(s.semester, [...(bySemester.get(s.semester) ?? []), s]);
  }
  const semesters = [...bySemester.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, list]) => ({ n, subjects: latestPerSubject([...list].sort((a, b) => order(a) - order(b) || a.at - b.at).map((s) => s.subjects)) }));
  const own = semesters.find((s) => s.n === semester)?.subjects ?? [];
  const sgpa = computeSgpa(own, rules.showSgpa, rules.decimals);
  const cgpa = computeCgpa(semesters.map((s) => s.subjects), rules.showCgpa, rules.decimals);
  return {
    sgpa: sgpa.sgpa, sgpaWithheld: sgpa.withheld,
    cgpa: cgpa.cgpa, cgpaWithheld: cgpa.withheld,
    semesterBacklogs: sgpa.backlogs, backlogs: cgpa.backlogs,
  };
}
