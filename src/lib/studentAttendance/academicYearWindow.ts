import type { Firestore } from "firebase-admin/firestore";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import {
  academicSessionLabel, academicYearRange, currentAcademicStartYear, parseAcademicYearStart,
  resolveAcademicYearEnd, resolveAcademicYearStart, type AcademicYearStart,
} from "@/lib/college/academicSession";

// Cohort integrity for attendance reports (audit F-24).
//
// A Section is a fixed year-slot ("CSE Year 2 Section A") that a different
// cohort of students occupies each academic year. Its attendance sessions used
// to carry no academic year, so a report on the section after a promotion mixed
// the previous cohort's sessions into the new cohort's percentages. Sessions are
// now stamped with `academicYear` when created (student-attendance POST,
// office-correction POST), and the section-scoped reports select ONE academic
// year - the current one unless asked otherwise.
//
// Sessions written before the stamp existed carry no `academicYear`; they are
// classified by their DATE against the college's own academic-year start day
// (Settings > Academic Year). That is the read fallback: nothing in Firestore
// needs migrating for old sessions to land in the right year.

export interface AcademicYearConfig {
  start: AcademicYearStart;
  end: AcademicYearStart;
  /** The college's current academic year, short form ("2026-27"). */
  currentLabel: string;
}

export interface AcademicYearWindow {
  label: string;
  /** Inclusive IST calendar dates, "YYYY-MM-DD". */
  from: string;
  to: string;
  isCurrent: boolean;
}

export async function loadAcademicYearConfig(db: Firestore, collegeId: string, now: Date = new Date()): Promise<AcademicYearConfig> {
  const [settings, currentLabel] = await Promise.all([
    loadCollegeSettings(db, collegeId),
    resolveCollegeAcademicYear(db, collegeId, now),
  ]);
  return { start: resolveAcademicYearStart(settings), end: resolveAcademicYearEnd(settings), currentLabel };
}

/** The window for a "2026-27" / "2026-2027" label, or null when the label isn't a year range. */
export function windowForAcademicYear(label: string, cfg: AcademicYearConfig): AcademicYearWindow | null {
  const startYear = parseAcademicYearStart(label);
  if (startYear == null) return null;
  const range = academicYearRange(startYear, cfg.start, cfg.end);
  const short = academicSessionLabel(startYear);
  return { label: short, from: range.from, to: range.to, isCurrent: parseAcademicYearStart(cfg.currentLabel) === startYear };
}

/**
 * Which window a report request asks for. Absent / "" / "current" -> the
 * current academic year; "all" -> null (no window: every session, the old
 * unbounded behaviour); a label -> that year. `error` for anything else.
 */
export function resolveAcademicYearRequest(
  param: string | null | undefined,
  cfg: AcademicYearConfig
): { window: AcademicYearWindow | null; error?: undefined } | { window?: undefined; error: string } {
  const p = (param ?? "").trim();
  if (p.toLowerCase() === "all") return { window: null };
  const label = p === "" || p.toLowerCase() === "current" ? cfg.currentLabel : p;
  const window = windowForAcademicYear(label, cfg);
  return window ? { window } : { error: "academicYear must look like 2026-27, or be \"all\"" };
}

/** The academic year a calendar date falls in under the college's start day, short form. */
export function academicYearOfDate(dateISO: string, start: AcademicYearStart): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!m) return null;
  return academicSessionLabel(currentAcademicStartYear(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), start));
}

/**
 * Whether a session belongs to the window: its own stamp when it has one,
 * otherwise its date. A null window (academicYear=all) includes everything.
 */
export function sessionInAcademicYear(
  session: { academicYear?: string | null; date: string },
  window: AcademicYearWindow | null
): boolean {
  if (!window) return true;
  const stamped = parseAcademicYearStart(session.academicYear);
  if (stamped != null) return stamped === parseAcademicYearStart(window.label);
  return session.date >= window.from && session.date <= window.to;
}
