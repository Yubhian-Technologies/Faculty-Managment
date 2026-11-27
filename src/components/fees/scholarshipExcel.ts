"use client";

// Scholarship Cell uploads (FR / NFR list, government receipts): reads the first sheet of an .xlsx in the browser
// into rows keyed by header (case / spaces ignored). Regd. No is required; the other columns are named by the caller.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (v: unknown): string => {
  if (v == null) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown };
    if (o.richText) return o.richText.map((t) => t.text).join("").trim();
    if ("result" in o) return text(o.result);
    if (typeof o.text === "string") return o.text.trim();
  }
  return String(v).trim();
};

/** Rows of { [wanted key]: cell text }; `columns` maps a key to the header names it may have (required), `optional`
 *  likewise (blank when the file has no such column). The header row is the first of the top 10 rows holding every
 *  required column, so a title line above it (or a blank first row) is fine. Date cells come back as YYYY-MM-DD.
 *  Each row carries its sheet row number as `_row`. */
export async function readSheet(file: File, columns: Record<string, string[]>, optional: Record<string, string[]> = {}): Promise<{ rows: Record<string, string>[] } | { error: string }> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(await file.arrayBuffer()); } catch { return { error: "Unable to read the file. Save it as .xlsx and try again." }; }
  const ws = wb.worksheets[0];
  if (!ws) return { error: "The file has no sheet." };
  const headerOf = (n: number) => { const h: string[] = []; ws.getRow(n).eachCell({ includeEmpty: true }, (cell, i) => { h[i] = norm(text(cell.value)); }); return h; };
  const find = (header: string[], names: string[]) => header.findIndex((h) => h && names.map(norm).includes(h));
  let headAt = 0, header: string[] = [];
  for (let n = 1; n <= Math.min(10, ws.rowCount); n++) {
    const h = headerOf(n);
    if (Object.values(columns).every((names) => find(h, names) >= 0)) { headAt = n; header = h; break; }
  }
  if (!headAt) {
    const first = Object.values(columns)[0]?.[0] ?? "";
    const h1 = headerOf(1);
    const missing = Object.values(columns).find((names) => find(h1, names) < 0)?.[0] ?? first;
    return { error: `The header row must have a "${missing}" column.` };
  }
  const at: Record<string, number> = {};
  for (const [key, names] of Object.entries(columns)) at[key] = find(header, names);
  for (const [key, names] of Object.entries(optional)) { const i = find(header, names); if (i >= 0) at[key] = i; }
  const rows: Record<string, string>[] = [];
  ws.eachRow((row, n) => {
    if (n <= headAt) return;
    const r = Object.fromEntries(Object.keys({ ...columns, ...optional }).map((k) => [k, at[k] === undefined ? "" : text(row.getCell(at[k]).value)]));
    if (Object.values(r).some(Boolean)) rows.push({ ...r, _row: String(n) });
  });
  return { rows };
}

/** A one-sheet template with the given headers and one example row. */
export async function downloadTemplate(name: string, headers: string[], example: (string | number)[]) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(headers).font = { bold: true };
  ws.addRow(example);
  ws.columns.forEach((c) => { c.width = 20; });
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  a.download = `${name}.xlsx`;
  a.click();
}
