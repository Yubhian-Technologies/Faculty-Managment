// Rooms created before benches existed only have a `capacity`; read them as
// that many benches with one student each, so nothing breaks until College
// Office edits them.
export function roomBenches(r: { benches?: number; capacity: number }): number {
  return r.benches ?? r.capacity;
}

export function roomPerBench(r: { studentsPerBench?: number; perBench?: number }): number {
  return r.studentsPerBench ?? r.perBench ?? 1;
}

/** Bench columns of a room (the layout); absent = not entered, the room prints as a plain bench list. */
export function roomColumns(r: { columns?: number | null; benches?: number; capacity: number }): number | undefined {
  const c = Number(r.columns);
  return Number.isInteger(c) && c >= 1 ? Math.min(c, roomBenches(r)) : undefined;
}

/** Benches in the longest column - 30 benches in 4 columns = 8 rows (the last column holds 6). */
export function roomRows(benches: number, columns: number): number {
  return Math.ceil(benches / Math.max(1, columns));
}

/**
 * Where bench `n` stands: benches are numbered column by column - column 1
 * front to back, then column 2 ... - so seating benches 1, 2, 3 ... in order
 * fills the room column by column.
 */
export function benchPosition(n: number, benches: number, columns: number): { column: number; row: number } {
  const rows = roomRows(benches, columns);
  return { column: Math.floor((n - 1) / rows) + 1, row: ((n - 1) % rows) + 1 };
}

/** The checks for an entered column count: a whole number from 1 to the benches. */
export function columnsError(columns: number, benches: number): string | null {
  if (!Number.isInteger(columns) || columns < 1) return "Columns must be a whole number, at least 1";
  if (columns > benches) return "Columns can't be more than the benches";
  return null;
}
