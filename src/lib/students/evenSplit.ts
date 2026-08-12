// Deals a list of students out across a list of buckets (sections) in order,
// as evenly as possible: with N students over K sections the first (N mod K)
// sections get one extra, so sizes differ by at most one and the earliest
// entries land in the earliest section. Callers sort by full name first, which
// makes this the "divide the branch's students into sections A/B/C by initial"
// step a (sub-)HOD runs after creating the sections.
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
