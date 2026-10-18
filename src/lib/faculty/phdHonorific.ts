// A faculty member whose Highest Qualification is Ph.D gets the honorific "Dr." by default.
//
// The rule, in one place (used by every save route, the three identity forms and scripts/apply-phd-honorific.mjs):
//   - it only FILLS a blank honorific - an honorific somebody chose ("Prof.", "Mr.", "Mrs.") is never replaced;
//   - it uses the college's OWN catalog entry for "Dr" (colleges/{id}/honorifics), spelled the way that college wrote it
//     ("Dr." or "Dr"), and does nothing when the college's catalog has no such entry - it never invents an honorific the
//     Principal has not added;
//   - it never removes an honorific: changing the qualification away from Ph.D later leaves "Dr." as it is.
//
// Keep this file dependency-free and TypeScript-erasable (no `@/` imports): the migration script loads it with Node's native
// type stripping.

/** Same normalisation as the Honorific Catalog's own duplicate check: "Dr.", "dr" and "DR" are one honorific. */
export function honorificKey(value: string | undefined | null): string {
  return (value?.trim() ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export const isBlankHonorific = (value: unknown): boolean => value === undefined || value === null || (typeof value === "string" && value.trim() === "");

/** The college's own spelling of "Dr" from its active honorifics, or null when it has none. Prefers "Dr." when both exist. */
export function catalogDrName(catalog: readonly string[]): string | null {
  const matches = catalog.filter((n) => honorificKey(n) === "dr");
  if (matches.length === 0) return null;
  return matches.find((n) => n.trim() === "Dr.") ?? matches[0].trim();
}

/**
 * The honorific to fill in, or null to leave things as they are. `isPhd` is the caller's reading of the stored/entered
 * Highest Qualification (normalizeHighestQualification(q) === "Ph.D").
 */
export function honorificForPhd(input: { isPhd: boolean; honorific: unknown }, catalog: readonly string[]): string | null {
  if (!input.isPhd) return null;
  if (!isBlankHonorific(input.honorific)) return null;
  return catalogDrName(catalog);
}
