import type { PastAttendanceGrid } from "./pastImportGrid";

// A late joiner in an uploaded attendance register: their row is BLANK on the first class days (other students of the
// sheet have P / A there, so classes were held) and starts with P / A later. That first marked date is offered as the
// student's Date of Joining (confirmed in the import preview, never over one already entered) - attendance then counts
// from it everywhere (joiningDate.ts). Blanks in the middle of a row are just "no record", not a joining date, and a row
// that is blank on the file's first dates only because NO class was held then suggests nothing.

export interface JoiningSuggestion {
  roll: string;
  /** "YYYY-MM-DD": the student's first P / A in the sheet. */
  date: string;
  /** Class days (someone else marked) the student is blank on before it. */
  blankClassDays: number;
}

export function joiningDatesFromRegister(grid: Pick<PastAttendanceGrid, "dates" | "students">): JoiningSuggestion[] {
  // A date counts as a class day when at least one student of the sheet has a P or A on it.
  const classDay = grid.dates.map((_, i) => grid.students.some((s) => s.marks[i] != null));
  const out: JoiningSuggestion[] = [];
  for (const s of grid.students) {
    const first = s.marks.findIndex((m) => m != null);
    if (first <= 0) continue; // marked from the file's first date, or blank throughout
    const blankClassDays = classDay.slice(0, first).filter(Boolean).length;
    if (blankClassDays === 0) continue; // no class was held before their first mark
    out.push({ roll: s.roll, date: grid.dates[first], blankClassDays });
  }
  return out;
}
