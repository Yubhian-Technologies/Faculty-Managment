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

/**
 * Rounds the way the university prints SGPA / CGPA: to the nearest, and an
 * EXACT halfway value to the even digit ("round half to even") - 8.125 is
 * printed 8.12 (24B01A4601, Semester 3: 162.5 / 20), while 8.6154 is 8.62.
 * A value only a floating-point hair from halfway counts as halfway.
 */
export function roundGpa(value: number, decimals: number): number {
  const d = Number.isInteger(decimals) && decimals >= 0 && decimals <= 4 ? decimals : 2;
  const f = 10 ** d;
  const x = value * f;
  const floor = Math.floor(x);
  const frac = x - floor;
  if (Math.abs(frac - 0.5) < 1e-9) return (floor % 2 === 0 ? floor : floor + 1) / f;
  return Math.round(x) / f;
}
const round = roundGpa;

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
 * each): Σ(semester credits x SGPA) / Σ semester credits, by default with each
 * SGPA as printed (rounded) - see `from`.
 */
export function computeCgpa(semesters: GpaSubject[][], showRule: GpaShowRule, decimals = 2, from: "PRINTED" | "EXACT" = "PRINTED"): CumulativeGpa {
  // Each semester is taken in full ("ALWAYS") here - whether the CGPA itself
  // may be shown is this function's own rule, applied once below.
  const parts = semesters.map((s) => computeSgpa(s, "ALWAYS", decimals));
  const credits = parts.reduce((sum, p) => sum + p.credits, 0);
  // PRINTED: semester credits x the SGPA as printed on the memo (rounded) -
  // the university's way: 19.5 x 7.97 + 20.5 x 8.85 = 336.84 / 40 = 8.42,
  // where the exact values give 8.425 -> 8.43. EXACT: Σ(Ci x Gi) over everything.
  const weightedPoints = parts.reduce((sum, p) => sum + (from === "EXACT" || p.sgpa == null ? p.weightedPoints : p.credits * p.sgpa), 0);
  const backlogs = parts.flatMap((p) => p.backlogs);
  const withheld = showRule === "ALL_PASSED" && backlogs.length > 0;
  return {
    cgpa: credits > 0 && !withheld ? round(weightedPoints / credits, decimals) : null,
    credits,
    backlogs,
    withheld,
  };
}

/** One sitting of one semester for a student (a Regular, Supplementary or Revaluation sheet). */
export interface StudentSitting {
  semester: number;
  /** "2026-27" - orders attempts that carry no exam date. */
  academicYear?: string;
  /** "2026-11" - the month the exam was held; attempts are ordered by it first. */
  examHeld?: string;
  examType: "REGULAR" | "SUPPLEMENTARY" | "REVALUATION";
  /** The sheet the sitting came from - what a revaluation points at. */
  batchId?: string;
  /** REVALUATION only: the batch of the sitting it re-grades. */
  revaluesBatchId?: string;
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
  rules: { showSgpa: GpaShowRule; showCgpa: GpaShowRule; decimals: number; cgpaFrom?: "PRINTED" | "EXACT" }
): StudentStanding {
  const bySemester = new Map<number, StudentSitting[]>();
  for (const s of applyRevaluations(sittings)) {
    if (s.semester > semester) continue;
    bySemester.set(s.semester, [...(bySemester.get(s.semester) ?? []), s]);
  }
  const semesters = [...bySemester.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, list]) => ({ n, subjects: finalPerSubject(orderSittings(list).map((s) => s.subjects)) }));
  const own = semesters.find((s) => s.n === semester)?.subjects ?? [];
  const sgpa = computeSgpa(own, rules.showSgpa, rules.decimals);
  const cgpa = computeCgpa(semesters.map((s) => s.subjects), rules.showCgpa, rules.decimals, rules.cgpaFrom ?? "PRINTED");
  return {
    sgpa: sgpa.sgpa, sgpaWithheld: sgpa.withheld,
    cgpa: cgpa.cgpa, cgpaWithheld: cgpa.withheld,
    semesterBacklogs: sgpa.backlogs, backlogs: cgpa.backlogs,
  };
}

/**
 * Sittings oldest first: by the month the exam was held (else the start of its
 * academic year), then Regular, Supplementary, Revaluation, then import time.
 */
export function orderSittings<T extends Pick<StudentSitting, "academicYear" | "examHeld" | "examType" | "at">>(list: T[]): T[] {
  const when = (s: T) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(s.examHeld ?? ""));
    if (m) return Number(m[1]) * 12 + Number(m[2]);
    const ay = Number(String(s.academicYear ?? "").slice(0, 4));
    return ay ? ay * 12 : 0;
  };
  const order = (s: T) => (s.examType === "REGULAR" ? 0 : s.examType === "SUPPLEMENTARY" ? 1 : 2);
  return [...list].sort((a, b) => when(a) - when(b) || order(a) - order(b) || a.at - b.at);
}

/** The better of two results of one subject: a pass beats a fail, else more points win; a tie keeps `current`. */
export function betterResult<T extends Pick<GpaSubject, "isPass" | "points">>(current: T, candidate: T): T {
  if (candidate.isPass !== current.isPass) return candidate.isPass ? candidate : current;
  return candidate.points > current.points ? candidate : current;
}

/**
 * Folds each revaluation into the sitting it re-grades - best of the two per
 * subject - and drops the revaluation sittings themselves. A revaluation whose
 * sitting is not in the list (not published) changes nothing.
 */
export function applyRevaluations<T extends StudentSitting>(sittings: T[]): T[] {
  const revals = sittings.filter((s) => s.examType === "REVALUATION");
  return sittings
    .filter((s) => s.examType !== "REVALUATION")
    .map((s) => {
      const mine = orderSittings(revals.filter((r) => r.revaluesBatchId && r.revaluesBatchId === s.batchId));
      if (mine.length === 0) return s;
      const subjects = s.subjects.map((sub) => {
        let best = sub;
        for (const r of mine) {
          const re = r.subjects.find((x) => x.subjectCode.trim().toUpperCase() === sub.subjectCode.trim().toUpperCase());
          if (re) best = betterResult(best, re);
        }
        return best;
      });
      return { ...s, subjects };
    });
}

/**
 * Each subject's final result over its sittings (oldest first): the latest
 * PASSING one, else the latest. A pass is never undone by a later fail - a
 * revaluation can turn a fail into a pass after a supplementary was sat.
 */
export function finalPerSubject<T extends GpaSubject>(attempts: T[][]): T[] {
  const latest = new Map<string, T>();
  const latestPass = new Map<string, T>();
  for (const sitting of attempts) {
    for (const s of sitting) {
      const k = s.subjectCode.trim().toUpperCase();
      latest.set(k, s);
      if (s.isPass) latestPass.set(k, s);
    }
  }
  return [...latest.entries()].map(([k, s]) => latestPass.get(k) ?? s);
}
