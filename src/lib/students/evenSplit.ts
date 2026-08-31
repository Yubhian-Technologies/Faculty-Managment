// Deals a list of students out across a list of buckets (sections) in order,
// as evenly as possible: with N students over K sections the first (N mod K)
// sections get one extra, so sizes differ by at most one and the earliest
// entries land in the earliest section. Callers sort by surnameKey first,
// which makes this the "divide the branch's students into sections A/B/C by
// surname" step a (sub-)HOD runs after creating the sections.
//
// Shared by college/students/distribute (one department at a time) and
// college/students/distribute-cohort (every branch of a shared first year in
// one action) so both split identically.
export function evenSplit<T>(items: T[], bucketCount: number): T[][] {
  if (bucketCount <= 0) return [];
  const base = Math.floor(items.length / bucketCount);
  const remainder = items.length % bucketCount;

  const buckets: T[][] = [];
  let cursor = 0;
  for (let i = 0; i < bucketCount; i++) {
    const size = base + (i < remainder ? 1 : 0);
    buckets.push(items.slice(cursor, cursor + size));
    cursor += size;
  }
  return buckets;
}

// Sort key for "surname order" distribution: the first whitespace-delimited
// token of a student's `name` (this college's students are conventionally
// entered surname-first, e.g. "Reddy Arjun"), lowercased so a stray case
// difference doesn't split otherwise-identical surnames apart. Empty/blank
// names sort to "" (first), same as the old plain-name compare's `?? ""`
// fallback.
export function surnameKey(name?: string): string {
  return (name ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

// Full deterministic student ordering: surname, then full name, then the
// student's own doc id. Two students can legitimately share a name in this
// college's data (no uniqueness constraint on `name` - see
// src/lib/students/duplicateDetection.ts's own doc-comment), and a Firestore
// query with no `.orderBy()` doesn't guarantee the same result order between
// two identical calls - so without the `id` tiebreak, two students tied on
// name could land in either order on different runs, silently swapping which
// one gets the last seat in a section. `id` is arbitrary but STABLE, which is
// all determinism here actually requires.
export function compareStudentsBySurname(a: { name?: string; id: string }, b: { name?: string; id: string }): number {
  const surnameCompare = surnameKey(a.name).localeCompare(surnameKey(b.name));
  if (surnameCompare !== 0) return surnameCompare;
  const nameCompare = (a.name ?? "").localeCompare(b.name ?? "");
  if (nameCompare !== 0) return nameCompare;
  return a.id.localeCompare(b.id);
}

// Natural-order section comparator: "Section 2" before "Section 10", not
// after (plain localeCompare would sort digit-by-digit and get this wrong).
// Sorting the CALLER's already-resolved section list with this - rather than
// trusting whatever order their ids arrived in - is what makes distribution
// independent of which order a checkbox UI happened to send them in.
export function compareSectionsByName(a: { name?: string }, b: { name?: string }): number {
  return (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true, sensitivity: "base" });
}
