// Research Areas/Interests (Academic Qualification tab) as a dedicated filter on the faculty lists - separate from the name /
// employee-ID search box, so a search for "ml" finds people by what they research, never by a name that happens to contain "ml".
// Stored as a list of free-text entries at academicProfile.researchAreasInterests; older records may hold a plain string or the
// pre-rename `researchAreas` key, so all of those are read. Read-only: nothing here writes to a faculty record.

type Row = Record<string, unknown>;

function entriesOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
  return typeof v === "string" && v.trim() ? [v.trim()] : [];
}

/** The research areas a person entered, one string per entry. */
export function researchAreaList(row: Row): string[] {
  const ap = row.academicProfile;
  if (typeof ap !== "object" || ap === null) return [];
  const p = ap as Row;
  const current = entriesOf(p.researchAreasInterests);
  return current.length > 0 ? current : entriesOf(p.researchAreas);
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** "ml/ds" or "iot, ai" -> ["ml", "ds"]: several terms are alternatives (any one is enough). One-letter terms are ignored. */
export function parseResearchQuery(query: string): string[] {
  return Array.from(new Set(query.split(/[,/;|\n]+/).map(words).filter((t) => t.length >= 2)));
}

/**
 * Does one research area answer a term? Matching is on whole words, not on pieces of words, so "ml" does not find "HTML":
 *   - a word of the area starts with the term:     "learn" -> "Machine Learning"; "ml" -> "ML for Healthcare"
 *   - a phrase of the area starts with the term:   "machine learn" -> "Machine Learning"
 *   - the term is the area's initials:             "ml" -> "Machine Learning", "ds" -> "Data Science", "iot" -> "Internet of Things"
 */
export function areaMatchesTerm(area: string, term: string): boolean {
  const a = words(area);
  if (!a || !term) return false;
  if (a === term || a.startsWith(term) || a.includes(` ${term}`)) return true;
  if (!term.includes(" ")) {
    const initials = a.split(" ").map((w) => w[0]).join("");
    if (initials === term || (term.length >= 3 && initials.startsWith(term))) return true;
  }
  return false;
}

/** The person's research areas that match the query (several terms = any of them); [] when none do or the query is empty. */
export function matchedResearchAreas(row: Row, query: string): string[] {
  const terms = parseResearchQuery(query);
  if (terms.length === 0) return [];
  return researchAreaList(row).filter((area) => terms.some((t) => areaMatchesTerm(area, t)));
}

/** True when the query holds at least one usable term, i.e. the filter is really on. */
export function researchQueryActive(query: string): boolean {
  return parseResearchQuery(query).length > 0;
}

export interface ResearchAreaOption { key: string; label: string; count: number }

/** Every distinct research area in the list (case-insensitive) with how many faculty hold it, most common first. */
export function researchAreaOptions(rows: Row[]): ResearchAreaOption[] {
  const byKey = new Map<string, { spellings: Map<string, number>; people: number }>();
  for (const r of rows) {
    const seen = new Set<string>();
    for (const area of researchAreaList(r)) {
      const key = words(area);
      if (!key) continue;
      const e = byKey.get(key) ?? { spellings: new Map<string, number>(), people: 0 };
      e.spellings.set(area, (e.spellings.get(area) ?? 0) + 1);
      if (!seen.has(key)) { e.people += 1; seen.add(key); }
      byKey.set(key, e);
    }
  }
  return Array.from(byKey, ([key, e]) => ({
    key,
    label: Array.from(e.spellings).sort((x, y) => y[1] - x[1] || Number(y[0] !== y[0].toLowerCase()) - Number(x[0] !== x[0].toLowerCase()) || x[0].localeCompare(y[0]))[0][0],
    count: e.people,
  })).sort((x, y) => y.count - x.count || x.label.localeCompare(y.label));
}

/** Rows that match the research-area query, each carrying `researchMatches` (what matched) for the list to show. No query = the rows as given. */
export function filterByResearchArea<T extends Row>(rows: T[], query: string): (T & { researchMatches?: string[] })[] {
  if (!researchQueryActive(query)) return rows;
  const out: (T & { researchMatches?: string[] })[] = [];
  for (const r of rows) {
    const hit = matchedResearchAreas(r, query);
    if (hit.length > 0) out.push({ ...r, researchMatches: hit });
  }
  return out;
}
