// The one display order for every student list (rosters, section pages,
// Students tables): by Regd. No, and - for the students imported without
// one - by name.
//
// Students who have a Regd. No come first, in roll order; those without one
// follow, in name order, so a half-numbered import still reads as a stable,
// predictable list instead of an arbitrary database order. Regd. Nos compare
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

// ── Regd. No order for the Students tables ─────────────────────────────────
// A Regd. No is a fixed prefix, a 2-digit branch code and a running serial:
//   26BV1A 05 151   (3-digit serial: 100, 101, ...)
//   24PA1A 04 I9    (a department past 99 continues A0-A9, B0-B9, ...)
//   24PA1A 01 56    (plain 2-digit serial)
// Colleges differ in how the serial runs on, and a plain "natural" compare
// reads the branch code and the serial as ONE number: "0599" > "05" + "A0"
// puts A0 before 01, and "05100" > "0601" puts branch 05's 100+ after branch
// 06. So the three parts are compared separately. A roll that doesn't have
// this shape (plain numbers, "R10", ...) keeps the natural compare, after the
// ones that do - two groups, each ordered consistently, so the sort stays a
// proper total order.

const ROLL_SHAPE = /^(\d{2}[A-Z0-9]{3}[A-Z])(\d{2})(.+)$/;

interface RollParts {
  prefix: string;
  branch: number;
  /** 0 = digits only (99 < 100 < 101), 1 = starts with a letter (A0 .. A9, B0 ..), 2 = anything else. */
  serialKind: 0 | 1 | 2;
  serialNumber: number;
  serialText: string;
}

function rollParts(roll: string): RollParts | null {
  const m = ROLL_SHAPE.exec(roll.toUpperCase());
  if (!m) return null;
  const serial = m[3];
  const kind = /^\d+$/.test(serial) ? 0 : /^[A-Z]/.test(serial) ? 1 : 2;
  return { prefix: m[1], branch: Number(m[2]), serialKind: kind, serialNumber: kind === 0 ? Number(serial) : 0, serialText: serial };
}

/** Both rolls are non-blank. */
function compareRolls(rollA: string, rollB: string): number {
  const a = rollParts(rollA);
  const b = rollParts(rollB);
  if (a && !b) return -1;
  if (!a && b) return 1;
  if (!a || !b) return collator.compare(rollA, rollB);
  if (a.prefix !== b.prefix) return a.prefix < b.prefix ? -1 : 1;
  if (a.branch !== b.branch) return a.branch - b.branch;
  if (a.serialKind !== b.serialKind) return a.serialKind - b.serialKind;
  if (a.serialKind === 0) return a.serialNumber - b.serialNumber;
  return collator.compare(a.serialText, b.serialText);
}

interface SectionOrderableStudent extends OrderableStudent {
  section?: string | null;
  year?: number | string | null;
}

/** A usable year number (1, 2, ...), or null when missing / not a positive number. */
function yearOf(value: number | string | null | undefined): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The Office / Principal Students table's order: by Year (1st, 2nd, 3rd, 4th),
 * then by Section, then by Regd. No inside each section - blank Regd. Nos last,
 * by name, as above; the Regd. Nos themselves by compareRolls (serial-aware).
 *
 * Sections compare naturally ("A" < "B", "2" < "10"); students in no section
 * ("" / missing) come after every named one of their year, in the same Regd.
 * No order, so the unplaced are never mixed into a section. A student with no
 * year comes after every year. Display only: separate from
 * compareStudentsForList on purpose - the attendance, mentoring and roster
 * screens that use that one keep their order untouched.
 */
export function compareStudentsBySectionThenRoll(a: SectionOrderableStudent, b: SectionOrderableStudent): number {
  const yearA = yearOf(a.year);
  const yearB = yearOf(b.year);
  if (yearA !== null && yearB === null) return -1;
  if (yearA === null && yearB !== null) return 1;
  if (yearA !== null && yearB !== null && yearA !== yearB) return yearA - yearB;

  const sectionA = (a.section ?? "").trim();
  const sectionB = (b.section ?? "").trim();
  if (sectionA && !sectionB) return -1;
  if (!sectionA && sectionB) return 1;
  if (sectionA && sectionB) {
    const bySection = collator.compare(sectionA, sectionB);
    if (bySection !== 0) return bySection;
  }

  const rollA = (a.rollNumber ?? "").trim();
  const rollB = (b.rollNumber ?? "").trim();
  if (rollA && !rollB) return -1;
  if (!rollA && rollB) return 1;
  if (rollA && rollB) {
    const byRoll = compareRolls(rollA, rollB);
    if (byRoll !== 0) return byRoll;
  }

  const byName = collator.compare((a.name ?? "").trim(), (b.name ?? "").trim());
  if (byName !== 0) return byName;
  return (a.id ?? "").localeCompare(b.id ?? "");
}

export function sortStudentsForList<T extends OrderableStudent>(students: T[]): T[] {
  return students.sort(compareStudentsForList);
}
