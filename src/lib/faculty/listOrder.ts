import { allPreviousExperienceEntries, experienceBreakdown } from "./experienceCalc";
import { facultyDisplayName } from "./facultyDisplayName";

// The default order of a faculty list (the HOD's register, the Principal's lists, the College Office list):
//   1. the HOD (every person holding an HOD seat) at the top,
//   2. then the Principal, when the list has them,
//   3. then everyone else by TOTAL experience (internal at this college + external, overlaps counted once) - highest first.
// Ties (and people with no experience, who count as 0) fall back to the name so the order never jumps around.
//
// Who holds which seat comes with each row as `seatRoleCodes` (added by GET /api/college/faculty?withSeats=1). A list that did
// not ask for seats simply has no HOD / Principal to pin and is ordered by internal experience alone.
// Only the default: when a person picks a sort arrow on the page, that choice wins.

type Row = Record<string, unknown>;

export type SeatRank = 0 | 1 | 2;

export function seatRank(f: Row): SeatRank {
  const roles = Array.isArray(f.seatRoleCodes) ? (f.seatRoleCodes as unknown[]) : [];
  if (roles.includes("HOD")) return 0;
  if (roles.includes("PRINCIPAL")) return 1;
  return 2;
}

/** Years served here since the Date of Joining (0 with no joining date, or a joining date in the future). */
export function internalExperienceYears(f: Row): number {
  return experienceBreakdown(
    allPreviousExperienceEntries(f.academicProfile as Parameters<typeof allPreviousExperienceEntries>[0]),
    f.joiningDate as Parameters<typeof experienceBreakdown>[1],
  ).internal;
}

/** Internal + external experience in years, the same Total the register shows. */
export function totalExperienceYears(f: Row): number {
  return experienceBreakdown(
    allPreviousExperienceEntries(f.academicProfile as Parameters<typeof allPreviousExperienceEntries>[0]),
    f.joiningDate as Parameters<typeof experienceBreakdown>[1],
  ).total;
}

/** Array.sort() comparator: HOD, then Principal, then total experience (highest first), then name. */
export function compareDefaultFacultyOrder(a: unknown, b: unknown): number {
  const x = a as Row;
  const y = b as Row;
  const rank = seatRank(x) - seatRank(y);
  if (rank !== 0) return rank;
  const diff = totalExperienceYears(y) - totalExperienceYears(x);
  if (diff !== 0) return diff;
  return facultyDisplayName(x as { legalName?: string; honorific?: string }).localeCompare(facultyDisplayName(y as { legalName?: string; honorific?: string }));
}
