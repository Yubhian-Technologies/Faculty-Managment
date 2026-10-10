import { bulkFieldLabel, isBulkUpdateField, type BulkUpdateRow } from "./bulkUpdate";

/** One preview call takes the whole file (reads only). */
export const MAX_BULK_UPDATE_ROWS = 2000;
/** One apply call writes at most this many students (each in its own transaction); the page sends the file in chunks. */
export const MAX_BULK_APPLY_ROWS = 100;

export interface ParsedBulkRequest {
  rows: BulkUpdateRow[];
  fields: string[];
  fillOnly: boolean;
}

/**
 * Validates the envelope of what the page posted. Strict about WHICH fields may be touched (only the allow-listed
 * detail fields - never Student Mobile No, Roll No, name, department, year...), lenient about the cells (a bad cell is
 * the classifier's job to report per row).
 */
export function parseBulkUpdateRequest(body: { rows?: unknown; fields?: unknown; fillOnly?: unknown }, maxRows: number): ParsedBulkRequest | { error: string } {
  if (!Array.isArray(body.fields) || body.fields.length === 0) return { error: "Choose at least one field to update" };
  const fields = Array.from(new Set(body.fields.map((f) => String(f))));
  const notAllowed = fields.filter((f) => !isBulkUpdateField(f));
  if (notAllowed.length > 0) return { error: `These fields can't be changed with this import: ${notAllowed.join(", ")}` };

  if (!Array.isArray(body.rows)) return { error: "No rows were sent" };
  if (body.rows.length === 0) return { error: "The file has no rows" };
  if (body.rows.length > maxRows) {
    return { error: `That is ${body.rows.length} rows - at most ${maxRows} can be sent at once` };
  }

  const rows: BulkUpdateRow[] = [];
  for (let i = 0; i < body.rows.length; i++) {
    const r = body.rows[i] as { rowNumber?: unknown; mobile?: unknown; values?: unknown };
    if (!r || typeof r !== "object") return { error: `Row ${i + 1} is not readable` };
    const values: Record<string, string> = {};
    if (r.values && typeof r.values === "object" && !Array.isArray(r.values)) {
      for (const [k, v] of Object.entries(r.values as Record<string, unknown>)) {
        if (v === undefined || v === null || !String(v).trim()) continue;
        if (!fields.includes(k)) return { error: `Row ${i + 1} has a value for "${bulkFieldLabel(k)}", which was not one of the chosen fields` };
        values[k] = String(v);
      }
    }
    rows.push({
      rowNumber: typeof r.rowNumber === "number" && Number.isFinite(r.rowNumber) ? r.rowNumber : i + 2,
      mobile: r.mobile == null ? "" : String(r.mobile),
      values,
    });
  }
  return { rows, fields, fillOnly: body.fillOnly === true };
}
