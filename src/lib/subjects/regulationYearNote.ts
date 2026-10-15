import { admissionStartYearForCourseYear, parseBatchStartYears } from "@/lib/college/academicSession";

// What to tell someone assigning a subject of regulation R to Year N, judged on WHEN R's batches
// sit in Year N - not on which regulation happens to be taught there today. The old message said
// "ready for when R reaches Year N" whenever another regulation was current, which is wrong for a
// regulation whose batches have already gone through Year N: subjects are often assigned to such a
// regulation to enter past semesters' marks and grades. Pure.
//
// `regulationBatches` is the catalog's regulation -> "2023-2027,2024-2028" map; a batch sits in
// Year N now when its start year is asOfStartYear - N + 1. Returns "" when nothing needs saying:
// this regulation IS the one taught now, it has no batch years on record, or its batches straddle
// the current one (nothing accurate to claim).
export function regulationYearNote(
  regulationBatches: Record<string, string>,
  regulation: string,
  year: number,
  asOfStartYear: number,
): string {
  const batches = parseBatchStartYears(regulationBatches?.[regulation] ?? "");
  if (batches.length === 0) return "";
  const current = admissionStartYearForCourseYear(asOfStartYear, year);
  if (batches.includes(current)) return "";
  if (batches.every((b) => b < current)) {
    return `${regulation}'s batches have already passed Year ${year}, so no current students are in it. Fine for entering past semesters' marks and grades.`;
  }
  if (batches.every((b) => b > current)) {
    return `${regulation} isn't in Year ${year} yet - these subjects will be ready for when a ${regulation} batch reaches Year ${year}.`;
  }
  return "";
}
