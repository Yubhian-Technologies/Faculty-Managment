// The Section filter of the College Office / Principal-tier Students list.
//
// A student's `section` is the Section's NAME ("A", "B", ...), or "" / absent
// while they are not placed in one. Names repeat across departments and years,
// so the filter is a name that narrows whatever the Department / Course / Year
// filters already picked - it never stands for one particular section document.
//
// Client-safe (no server imports): the list API and both pages use the same
// rule, so what a page offers and what the server returns can't drift apart.

/** The dropdown / query value for "students not placed in any section". */
export const UNASSIGNED_SECTION = "__unassigned__";

/** "" / "all" mean no filter; everything else is a section name or UNASSIGNED_SECTION. */
export function normalizeSectionFilter(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  return v === "all" ? "" : v;
}

/** Whether a student's stored `section` passes the filter. An empty filter passes everyone. */
export function sectionMatchesFilter(studentSection: unknown, filter: string): boolean {
  if (!filter) return true;
  const value = typeof studentSection === "string" ? studentSection : "";
  if (filter === UNASSIGNED_SECTION) return value.trim() === "";
  // Exact, like the Firestore equality the list may push down for it.
  return value === filter;
}

export interface SectionFilterSource {
  name?: string;
  department?: string;
  secondaryDepartments?: string[];
  year?: number;
}

/**
 * The section names to offer. Every section of the college counts, narrowed
 * only by what the picked Department / Year certainly rule out - a section
 * that is missing the field being compared is never dropped, so the list can
 * only ever err on the side of offering too much, never of hiding a section.
 *
 * `departments` is the picked department's roll-up (the department plus, for a
 * container, its sub-departments); [] means no department is picked. Like the
 * server's Department filter it matches a section filed under the department
 * OR cross-listed to it.
 */
export function sectionFilterOptions(
  sections: SectionFilterSource[],
  scope: { departments: string[]; year: string }
): string[] {
  const names = new Set(scope.departments.map((d) => d.trim()).filter(Boolean));
  const year = /^\d+$/.test(scope.year) ? Number(scope.year) : null;
  const out = new Set<string>();
  for (const s of sections) {
    const name = typeof s.name === "string" ? s.name.trim() : "";
    if (!name) continue;
    if (year !== null && typeof s.year === "number" && s.year !== year) continue;
    if (names.size > 0) {
      const dept = (s.department ?? "").trim();
      const cross = (s.secondaryDepartments ?? []).map((d) => (d ?? "").trim());
      if ((dept || cross.length > 0) && !names.has(dept) && !cross.some((d) => names.has(d))) continue;
    }
    out.add(name);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

/**
 * The pick to keep after the options change underneath it: a pick that is no
 * longer offered falls back to "all" - but only once the sections have loaded,
 * so a pick restored from the address bar isn't discarded while they are still
 * on their way.
 */
export function keepSectionPick(pick: string, options: string[], loaded: boolean): string {
  if (pick === "all" || pick === UNASSIGNED_SECTION || !loaded) return pick;
  return options.includes(pick) ? pick : "all";
}
