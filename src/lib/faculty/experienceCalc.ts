import { toDate } from "@/lib/utils";

// Computes a Previous Experience entry's own duration, the sum across every
// entry, and (combined with Date of Joining) this faculty member's live
// Total Years of Experience - used by the read-out shown next to each row
// (AcademicProfileModuleFields.tsx's ExperienceFields), by
// FacultyMember.experienceYears (kept in sync at save time - see
// hod/faculty/[id]/[module]/edit/page.tsx and the Add Faculty wizard), and by
// the "Total Years of Experience" fact shown on the profile (FacultyProfileHub).

export interface DateDuration {
  years: number;
  months: number;
  days: number;
}

const ZERO_DURATION: DateDuration = { years: 0, months: 0, days: 0 };

// Exact whole-day count between two real Date objects - the one number every
// duration below is ultimately built from, so nothing here compounds
// rounding error the way summing pre-rounded per-row years used to.
function exactDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

// Calendar-accurate years/months/days between two real Date objects - walks
// actual month lengths (Jan = 31, Feb = 28/29, ...) instead of assuming an
// average year/month length, so it's exact for any single date range.
function calendarDiff(from: Date, to: Date): DateDuration {
  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  let days = to.getDate() - from.getDate();
  if (days < 0) {
    months -= 1;
    days += new Date(to.getFullYear(), to.getMonth(), 0).getDate(); // days in the month before `to`
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
}

// Accurate years/months/days between two "YYYY-MM-DD" dates - the per-row
// duration shown next to each Previous Experience entry. Returns zero for
// missing, invalid, or inverted dates.
export function durationBetween(fromDate: string | undefined, toDate: string | undefined): DateDuration {
  if (!fromDate || !toDate) return ZERO_DURATION;
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return ZERO_DURATION;
  return calendarDiff(from, to);
}

// "2 yrs 3 mos 10 days" - omits any unit that's zero.
export function formatDuration(d: DateDuration): string {
  const parts: string[] = [];
  if (d.years > 0) parts.push(`${d.years} yr${d.years !== 1 ? "s" : ""}`);
  if (d.months > 0) parts.push(`${d.months} mo${d.months !== 1 ? "s" : ""}`);
  if (d.days > 0) parts.push(`${d.days} day${d.days !== 1 ? "s" : ""}`);
  return parts.length > 0 ? parts.join(" ") : "Less than a day";
}

interface PreviousInstitutionLike {
  fromDate?: string;
  toDate?: string;
  fromYear?: number;
  toYear?: number;
}

// Legacy rows that only have fromYear/toYear (pre-dating the From/To Date
// fields) anchor to Jan 1 of each year - same read-time fallback
// ExperienceFields itself uses.
function rowDates(r: PreviousInstitutionLike): { fromDate?: string; toDate?: string } {
  return {
    fromDate: r.fromDate ?? (r.fromYear ? `${r.fromYear}-01-01` : undefined),
    toDate: r.toDate ?? (r.toYear ? `${r.toYear}-01-01` : undefined),
  };
}

// Sum of every Previous Experience row's exact day count.
function totalPreviousExperienceDays(rows: PreviousInstitutionLike[] | undefined): number {
  if (!rows || rows.length === 0) return 0;
  return rows.reduce((sum, r) => {
    const { fromDate, toDate } = rowDates(r);
    if (!fromDate || !toDate) return sum;
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return sum;
    return sum + exactDays(from, to);
  }, 0);
}

// Sum of every Previous Experience row's duration, as a plain decimal-years
// number - stored on FacultyMember.experienceYears (see hod/faculty/new &
// [id]/[module]/edit's "experience" save handlers) and read wherever a
// single sortable/filterable/exportable number is needed (CSV, resume,
// public profile, faculty list). Every row's exact day count is summed
// FIRST, with the one and only /365.25 conversion + rounding applied once at
// the very end - unlike the old version (which rounded each row to 1 decimal
// place BEFORE summing), this can't drift from compounding rounding error.
export function totalPreviousExperienceYears(rows: PreviousInstitutionLike[] | undefined): number {
  const days = totalPreviousExperienceDays(rows);
  return Math.round((days / 365.25) * 10) / 10;
}

// This faculty member's live Total Years of Experience: every Previous
// Experience row PLUS the time actually served since Date of Joining -
// increases day by day, not just when the record is re-saved (see the
// "Total Years of Experience" fact on FacultyProfileHub). Both components
// are summed as exact days first; the combined total is then converted back
// to years/months/days by reconstructing a start date `totalDays` before
// `asOf` and running the same calendar-accurate diff a single date range
// gets (calendarDiff) - this keeps the breakdown exact (real month lengths
// ending on `asOf`) instead of leaning on an average year/month length for
// the conversion.
export function totalYearsOfExperience(
  previousInstitutions: PreviousInstitutionLike[] | undefined,
  joiningDate: Parameters<typeof toDate>[0],
  asOf: Date = new Date()
): DateDuration {
  const prevDays = totalPreviousExperienceDays(previousInstitutions);
  const joined = toDate(joiningDate);
  const tenureDays = joined ? Math.max(0, exactDays(joined, asOf)) : 0;
  const totalDays = prevDays + tenureDays;
  if (totalDays <= 0) return ZERO_DURATION;
  const anchorStart = new Date(asOf.getTime() - totalDays * 86400000);
  return calendarDiff(anchorStart, asOf);
}
