// The one display order for every student list (rosters, section pages,
// Students tables): by roll number, and - for the students imported without
// one - by name.
//
// Students who have a roll number come first, in roll order; those without one
// follow, in name order, so a half-numbered import still reads as a stable,
// predictable list instead of an arbitrary database order. Roll numbers compare
// "naturally" (2 before 10, case-insensitive), so a roll like "24PA1A0502"
// sorts correctly next to "24PA1A0510" and numeric rolls don't sort as text.
//
// Display only. Section distribution deliberately keeps its own surname order
// (evenSplit.ts / compareStudentsBySurname) and must not use this.

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

interface OrderableStudent {
  id?: string;
  rollNumber?: string | null;
  name?: string | null;
}

export function compareStudentsForList(a: OrderableStudent, b: OrderableStudent): number {
  const rollA = (a.rollNumber ?? "").trim();
  const rollB = (b.rollNumber ?? "").trim();

  if (rollA && !rollB) return -1;
  if (!rollA && rollB) return 1;
  if (rollA && rollB) {
    const byRoll = collator.compare(rollA, rollB);
    if (byRoll !== 0) return byRoll;
  }

  const byName = collator.compare((a.name ?? "").trim(), (b.name ?? "").trim());
  if (byName !== 0) return byName;
  // Same roll/name: fall back to id so the order never depends on query order.
  return (a.id ?? "").localeCompare(b.id ?? "");
}

export function sortStudentsForList<T extends OrderableStudent>(students: T[]): T[] {
  return students.sort(compareStudentsForList);
}
