import { toDate } from "@/lib/utils";

// Computes a Previous Experience entry's own duration, the sum across every
// entry, and (combined with Date of Joining) this faculty member's live
// Total Years of Experience - used by the read-out shown next to each row
// (AcademicProfileModuleFields.tsx's ExperienceFields), by
// FacultyMember.totalYearsOfExperience (kept in sync at save time - see
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

export interface PreviousInstitutionLike {
  fromDate?: string;
  toDate?: string;
  fromYear?: number;
  toYear?: number;
  institutionName?: string;
  designation?: string;
  place?: string;
}

// Academic, Industry, and Research Experience are 3 separate tabs (same row
// shape - see ExperienceFields) that all roll up into one combined "previous
// experience" total - every caller computing Total/Internal/External Years of
// Experience combines all three through here rather than reading
// academicExperience alone.
//
// Accepts BOTH the current key names (academicExperience / industryExperience /
// researchExperience) and their legacy twins (previousInstitutions /
// industryExperienceEntries / researchExperienceEntries - see fieldRenames.ts),
// so a caller holding an un-normalised academicProfile still works. Per tab the
// current key wins when both are present, mirroring the registry's semantics.
interface ExperienceEntriesSource {
  academicExperience?: PreviousInstitutionLike[];
  industryExperience?: PreviousInstitutionLike[];
  researchExperience?: PreviousInstitutionLike[];
  // legacy read-fallbacks
  previousInstitutions?: PreviousInstitutionLike[];
  industryExperienceEntries?: PreviousInstitutionLike[];
  researchExperienceEntries?: PreviousInstitutionLike[];
}
export function allPreviousExperienceEntries(p: ExperienceEntriesSource | undefined): PreviousInstitutionLike[] {
  if (!p) return [];
  return [
    ...(p.academicExperience ?? p.previousInstitutions ?? []),
    ...(p.industryExperience ?? p.industryExperienceEntries ?? []),
    ...(p.researchExperience ?? p.researchExperienceEntries ?? []),
  ];
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

export interface ExperienceOverlap {
  entry: PreviousInstitutionLike;
  fromDate: string;
  toDate: string;
}

// Whether `current`'s date range overlaps any OTHER row's range (inclusive
// on both ends) - `current` itself, found by reference inside `rows`, is
// excluded so a row never "overlaps itself". Used to warn when a Previous
// Experience row (Academic/Industry/Research Experience - see
// allPreviousExperienceEntries) is set to a period that overlaps another
// one, since these three tabs roll up into one combined Total Years of
// Experience that would otherwise double-count the overlapping days.
// Rows with an incomplete range (missing either end) are skipped on both
// sides - nothing to compare yet.
export function findOverlappingExperience(
  rows: PreviousInstitutionLike[],
  current: PreviousInstitutionLike
): ExperienceOverlap | undefined {
  const { fromDate: curFrom, toDate: curTo } = rowDates(current);
  if (!curFrom || !curTo) return undefined;
  const curFromMs = new Date(curFrom).getTime();
  const curToMs = new Date(curTo).getTime();
  if (Number.isNaN(curFromMs) || Number.isNaN(curToMs)) return undefined;

  for (const entry of rows) {
    if (entry === current) continue;
    const { fromDate, toDate } = rowDates(entry);
    if (!fromDate || !toDate) continue;
    const fromMs = new Date(fromDate).getTime();
    const toMs = new Date(toDate).getTime();
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) continue;
    if (curFromMs <= toMs && fromMs <= curToMs) {
      return { entry, fromDate, toDate };
    }
  }
  return undefined;
}

// Valid [from, to] ranges of the rows as UTC day numbers. Open-ended or
// inverted rows are skipped (not counted).
function rowRanges(rows: PreviousInstitutionLike[] | undefined): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const r of rows ?? []) {
    const { fromDate, toDate } = rowDates(r);
    if (!fromDate || !toDate) continue;
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) continue;
    out.push([Math.round(from.getTime() / 86400000), Math.round(to.getTime() / 86400000)]);
  }
  return out;
}

// Days covered by the UNION of the ranges, so periods that overlap (within a
// tab, across tabs, or with service at this college) are counted once.
function unionDays(ranges: Array<[number, number]>): number {
  const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curFrom = 0;
  let curTo = 0;
  let open = false;
  for (const [f, t] of sorted) {
    if (!open) { curFrom = f; curTo = t; open = true; continue; }
    if (f <= curTo) { curTo = Math.max(curTo, t); continue; }
    total += curTo - curFrom;
    curFrom = f; curTo = t;
  }
  if (open) total += curTo - curFrom;
  return total;
}

// Tenure range [joining, asOf] in the same day numbers, if any.
function tenureRange(joiningDate: Parameters<typeof toDate>[0], asOf: Date): [number, number] | undefined {
  const joined = toDate(joiningDate);
  if (!joined) return undefined;
  const f = Math.round(joined.getTime() / 86400000);
  const t = Math.round(asOf.getTime() / 86400000);
  return t > f ? [f, t] : undefined;
}

// Exact day count of the previous-experience rows, overlaps counted once.
function totalPreviousExperienceDays(rows: PreviousInstitutionLike[] | undefined): number {
  return unionDays(rowRanges(rows));
}

// Sum of every Previous Experience row's duration, as a plain decimal-years
// number - stored on FacultyMember.totalYearsOfExperience (see hod/faculty/new &
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
  entries: PreviousInstitutionLike[] | undefined,
  joiningDate: Parameters<typeof toDate>[0],
  asOf: Date = new Date()
): DateDuration {
  const tenure = tenureRange(joiningDate, asOf);
  const totalDays = unionDays([...rowRanges(entries), ...(tenure ? [tenure] : [])]);
  if (totalDays <= 0) return ZERO_DURATION;
  const anchorStart = new Date(asOf.getTime() - totalDays * 86400000);
  return calendarDiff(anchorStart, asOf);
}

export interface ExperienceBreakdown {
  internal: number; // decimal years - time served since Date of Joining (0 for a future joiningDate)
  external: number; // decimal years - Academic + Industry + Research Experience entries summed
  total: number; // decimal years - internal + external
}

// The one decimal-years Internal/External/Total snapshot every "give me a
// plain sortable/exportable number" call site should use - FacultyMember.
// totalYearsOfExperience (see the create/update API routes), the CSV export, the
// resume PDF, and the public profile all go through this rather than each
// re-deriving their own rounding. Internal and external day counts are
// summed FIRST and each rounded to 1 decimal only once at the very end
// (same convention as totalPreviousExperienceYears), so total isn't just
// internal + external re-rounded on top of two already-rounded numbers.
export function experienceBreakdown(
  entries: PreviousInstitutionLike[] | undefined,
  joiningDate: Parameters<typeof toDate>[0],
  asOf: Date = new Date()
): ExperienceBreakdown {
  const tenure = tenureRange(joiningDate, asOf);
  const internalDays = tenure ? tenure[1] - tenure[0] : 0;
  // Total counts every calendar day once; external is what lies outside
  // service at this college, so internal + external = total.
  const totalDays = unionDays([...rowRanges(entries), ...(tenure ? [tenure] : [])]);
  const externalDays = totalDays - internalDays;
  const daysToYears = (days: number) => Math.round((days / 365.25) * 10) / 10;
  return {
    internal: daysToYears(internalDays),
    external: daysToYears(externalDays),
    total: daysToYears(totalDays),
  };
}
