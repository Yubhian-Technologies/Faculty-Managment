// Computes a Previous Experience entry's own duration, and the sum across
// every entry, from their From/To dates - used both for the live read-out
// shown next to each row (AcademicProfileModuleFields.tsx's ExperienceFields)
// and to keep FacultyMember.experienceYears (the "Total Years of Experience"
// shown on the list/PDF/profile) in sync whenever Previous Experience is
// edited - see hod/faculty/[id]/[module]/edit/page.tsx and the Add Faculty
// wizard, which both call totalPreviousExperienceYears() at save time.

// Fractional years between two ISO ("YYYY-MM-DD") dates, rounded to 1 decimal
// place - same precision fmtExp() in hod/faculty/page.tsx already displays
// experienceYears at. Returns 0 for missing, invalid, or inverted dates.
export function yearsBetween(fromDate: string | undefined, toDate: string | undefined): number {
  if (!fromDate || !toDate) return 0;
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return 0;
  const years = ms / (1000 * 60 * 60 * 24 * 365.25);
  return Math.round(years * 10) / 10;
}

// "2 yrs 6 mos" style label for a single row's computed duration.
export function formatExperienceDuration(years: number): string {
  if (years <= 0) return "";
  const totalMonths = Math.round(years * 12);
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths % 12;
  const parts: string[] = [];
  if (y > 0) parts.push(`${y} yr${y !== 1 ? "s" : ""}`);
  if (m > 0) parts.push(`${m} mo${m !== 1 ? "s" : ""}`);
  return parts.length > 0 ? parts.join(" ") : "< 1 mo";
}

// Sum of every Previous Experience row's duration - a legacy row that still
// only has fromYear/toYear (pre-dating the From/To Date fields) is anchored
// to Jan 1 of each year, same read-time fallback ExperienceFields itself uses.
export function totalPreviousExperienceYears(
  rows: { fromDate?: string; toDate?: string; fromYear?: number; toYear?: number }[] | undefined
): number {
  if (!rows || rows.length === 0) return 0;
  const total = rows.reduce((sum, r) => {
    const fromDate = r.fromDate ?? (r.fromYear ? `${r.fromYear}-01-01` : undefined);
    const toDate = r.toDate ?? (r.toYear ? `${r.toYear}-01-01` : undefined);
    return sum + yearsBetween(fromDate, toDate);
  }, 0);
  return Math.round(total * 10) / 10;
}
