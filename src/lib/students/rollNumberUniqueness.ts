// A student's roll number is a college-wide unique identifier - the same way a
// faculty member's employee id is. It used to be unique only within one
// (department, course, section, year), which let two students in different
// branches or years share a number. Every path that writes a roll number
// (import, single add, roll-number edit) goes through these helpers.
//
// Empty rolls never clash: many students are imported before the department
// assigns numbers, and any number of them can coexist.

/** Trimmed roll number, "" when absent. */
export function normalizeRoll(roll: unknown): string {
  return typeof roll === "string" ? roll.trim() : "";
}

/** Case-insensitive comparison key, "" when there is no roll. */
export function rollKey(roll: unknown): string {
  return normalizeRoll(roll).toLowerCase();
}

export function rollNumberTakenMessage(roll: string, holderName?: string): string {
  return `Roll number ${roll} is already assigned to ${holderName?.trim() || "another student"}. Roll numbers must be unique across the college.`;
}

/**
 * Builds the lookup an importer uses to reject a roll already held by ANY
 * student in the college. Feed it the existing students once, then `claim` each
 * accepted row so two rows in the same file can't share a number either.
 */
export function createRollRegistry(existing: Iterable<{ id?: string; rollNumber?: unknown; name?: unknown }>) {
  const holders = new Map<string, { id?: string; name: string }>();
  for (const s of existing) {
    const key = rollKey(s.rollNumber);
    if (key && !holders.has(key)) holders.set(key, { id: s.id, name: typeof s.name === "string" ? s.name : "" });
  }
  return {
    /** The student already holding this roll, or null when it is free (or blank). */
    holder(roll: unknown): { id?: string; name: string } | null {
      const key = rollKey(roll);
      return key ? holders.get(key) ?? null : null;
    },
    claim(roll: unknown, name: string): void {
      const key = rollKey(roll);
      if (key && !holders.has(key)) holders.set(key, { name });
    },
  };
}

interface StudentsCollection {
  where(field: string, op: "==", value: string): {
    get(): Promise<{ docs: { id: string; data(): { name?: unknown; rollNumber?: unknown } }[] }>;
  };
}

/**
 * The OTHER student (not `excludeId`) already holding `roll`, or null. One
 * equality query - served by Firestore's automatic single-field index, no
 * composite index needed.
 *
 * Exact-match on the trimmed value; a differently-cased duplicate already in
 * the database would slip past this query, which is why the importers use the
 * case-insensitive registry above instead.
 */
export async function findRollNumberConflict(
  students: StudentsCollection,
  roll: unknown,
  excludeId?: string
): Promise<{ id: string; name: string } | null> {
  const value = normalizeRoll(roll);
  if (!value) return null;
  const snap = await students.where("rollNumber", "==", value).get();
  const clash = snap.docs.find((d) => d.id !== excludeId);
  return clash ? { id: clash.id, name: typeof clash.data().name === "string" ? (clash.data().name as string) : "" } : null;
}
