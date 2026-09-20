// The year an award was received. AwardEntry no longer writes the scalar `year`
// (the edit form only stores dateOfAward), so year-only consumers (CSV, resume,
// public profile) derive it from dateOfAward and fall back to the legacy `year`
// still sitting on a record that hasn't been re-saved yet.
export function awardYear(a: { dateOfAward?: string; year?: number } | undefined): number | undefined {
  if (!a) return undefined;
  if (a.dateOfAward) {
    // "YYYY-MM-DD" - read the year straight off the string so a timezone shift
    // can never move Jan 1 back into the previous year.
    const y = Number(a.dateOfAward.slice(0, 4));
    if (Number.isInteger(y) && y > 0) return y;
  }
  return a.year || undefined;
}
