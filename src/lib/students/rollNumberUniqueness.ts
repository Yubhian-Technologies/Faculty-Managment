// A student's roll number is a unique identifier - the same way a faculty
// member's employee id is. It used to be unique only within one
// (department, course, section, year), which let two students in different
// branches or years share a number. Every path that writes a roll number
// (import, single add, roll-number edit) goes through these helpers for the
// writer's OWN college (checked against the real student documents, so it also
// covers students from before the registry); uniqueness across ALL colleges is
// the global registry's job (rollIdentity.ts), claimed on every one of those paths.
//
// Empty rolls never clash: many students are imported before the department
// assigns numbers, and any number of them can coexist.

import { studentRollKey } from "@/lib/students/loginDefaults";

/** Trimmed roll number, "" when absent. */
export function normalizeRoll(roll: unknown): string {
  return typeof roll === "string" ? roll.trim() : "";
}

/**
 * Comparison key, "" when there is no roll: the roll's letters and digits,
 * lower-case - the same normalisation as the login identity (loginDefaults.ts), so
 * "24PA1A0501", "24pa1a0501" and "24-PA1A0501" are one roll everywhere.
 */
export function rollKey(roll: unknown): string {
  return studentRollKey(normalizeRoll(roll));
}

export function rollNumberTakenMessage(roll: string, holderName?: string): string {
  return `Roll number ${roll} is already assigned to ${holderName?.trim() || "another student"}. Roll numbers must be unique.`;
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
 * The OTHER student (not `excludeId`) already holding `roll`, or null -
 * CASE-INSENSITIVELY, matching the importers' registry above.
 *
 * Firestore equality is case-sensitive, so a single `rollNumber == value`
 * query let "24pa1a0501" and "24PA1A0501" through as two different students
 * (and they collapse to one login identity). Every student document now also
 * carries `rollNumberUpper`; that field is checked first, and the three
 * spellings an older document (written before that field existed) could hold -
 * as typed, upper-case, lower-case - are checked on `rollNumber` as well.
 * All plain equality queries: served by Firestore's automatic single-field
 * indexes, no composite index. A legacy document in some OTHER mixed case and
 * without `rollNumberUpper` is only caught once the backfill script
 * (scripts/backfill-student-roll-keys.mjs) has stamped it.
 */
export async function findRollNumberConflict(
  students: StudentsCollection,
  roll: unknown,
  excludeId?: string
): Promise<{ id: string; name: string } | null> {
  const value = normalizeRoll(roll);
  if (!value) return null;
  const attempts: [string, string][] = [];
  const addAttempt = (field: string, v: string) => {
    if (!attempts.some(([f, x]) => f === field && x === v)) attempts.push([field, v]);
  };
  addAttempt("rollNumberUpper", value.toUpperCase());
  addAttempt("rollNumber", value);
  addAttempt("rollNumber", value.toUpperCase());
  addAttempt("rollNumber", value.toLowerCase());

  const snaps = await Promise.all(attempts.map(([field, v]) => students.where(field, "==", v).get()));
  for (const snap of snaps) {
    const clash = snap.docs.find((d) => d.id !== excludeId);
    if (clash) return { id: clash.id, name: typeof clash.data().name === "string" ? (clash.data().name as string) : "" };
  }
  return null;
}
