import type { RollMapRow } from "./rollMapping";

/**
 * One upload's worth of rows. Chosen to sit under the 400-500 range every other
 * bulk roster action uses (bulk-delete, bulk-create-login), so a single apply
 * stays within a couple of chunked passes and a failure is small enough to
 * re-run.
 */
export const MAX_ROLL_MAP_ROWS = 2000;

/**
 * Validates the shape of what the page posted. Deliberately strict about the
 * envelope and lenient about the cells: a malformed row is the classifier's job
 * to report per-row (BAD_ROLL / BAD_MOBILE), not a reason to refuse the file and
 * leave the Office guessing which line was wrong.
 */
export function parseRollMapRows(raw: unknown): { rows: RollMapRow[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "No rows were sent" };
  if (raw.length === 0) return { error: "The file has no rows" };
  if (raw.length > MAX_ROLL_MAP_ROWS) {
    return { error: `That file has ${raw.length} rows - split it into files of ${MAX_ROLL_MAP_ROWS} or fewer` };
  }

  const rows: RollMapRow[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as { rowNumber?: unknown; mobile?: unknown; roll?: unknown; name?: unknown };
    if (!r || typeof r !== "object") return { error: `Row ${i + 1} is not readable` };
    rows.push({
      // Falls back to the file position (+2 for the header row) so the results
      // table can always point at a line even if the page omitted the number.
      rowNumber: typeof r.rowNumber === "number" && Number.isFinite(r.rowNumber) ? r.rowNumber : i + 2,
      mobile: r.mobile == null ? "" : String(r.mobile),
      roll: r.roll == null ? "" : String(r.roll),
      ...(r.name == null ? {} : { name: String(r.name) }),
    });
  }
  return { rows };
}
