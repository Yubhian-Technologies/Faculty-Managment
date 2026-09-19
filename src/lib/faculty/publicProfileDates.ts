// Display dates for the public faculty profile. Entries saved with the current
// forms carry real "YYYY-MM-DD" dates (fromDate/toDate, dateOfAward,
// memberSince, ...); records that pre-date them only have the legacy year
// scalars (fromYear/toYear, year, sinceYear). Every helper prefers the real
// date and falls back to the legacy year, so both kinds of record show a date.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseDate(date: string | undefined): { year: number; month: number } | undefined {
  if (!date) return undefined;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(date);
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!year || month < 1 || month > 12) return undefined;
  return { year, month };
}

// Year of a "YYYY-MM-DD" (or "YYYY-MM") date, falling back to the legacy year.
export function publicYear(date: string | undefined, legacyYear?: number): number | undefined {
  return parseDate(date)?.year ?? (legacyYear || undefined);
}

// "Jun 2012" for a real date, "2012" for a legacy year-only value.
export function publicMonthYear(date: string | undefined, legacyYear?: number): string | undefined {
  const d = parseDate(date);
  if (d) return `${MONTHS[d.month - 1]} ${d.year}`;
  return legacyYear ? String(legacyYear) : undefined;
}

// "Jun 2012 – Jul 2015", or "Jun 2012 – present" when there is no end. Undefined
// when there is no start at all.
export function publicPeriod(
  fromDate: string | undefined, toDate: string | undefined, fromYear?: number, toYear?: number
): string | undefined {
  const from = publicMonthYear(fromDate, fromYear);
  if (!from) return undefined;
  return `${from} – ${publicMonthYear(toDate, toYear) ?? "present"}`;
}
