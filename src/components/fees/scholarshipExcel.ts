"use client";

// Scholarship Cell uploads (FR / NFR list, government receipts): reads the first sheet of an .xlsx in the browser
// into rows keyed by header (case / spaces ignored). Regd. No is required; the other columns are named by the caller.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown };
    if (o.richText) return o.richText.map((t) => t.text).join("").trim();
    if ("result" in o) return text(o.result);
    if (typeof o.text === "string") return o.text.trim();
  }
  return String(v).trim();
};

/** Rows of { [wanted key]: cell text }; `columns` maps a key to the header names it may have. */
export async function readSheet(file: File, columns: Record<string, string[]>): Promise<{ rows: Record<string, string>[] } | { error: string }> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(await file.arrayBuffer()); } catch { return { error: "Unable to read the file. Save it as .xlsx and try again." }; }
  const ws = wb.worksheets[0];
  if (!ws) return { error: "The file has no sheet." };
  const header: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, i) => { header[i] = norm(text(cell.value)); });
  const at: Record<string, number> = {};
  for (const [key, names] of Object.entries(columns)) {
    const i = header.findIndex((h) => h && names.map(norm).includes(h));
    if (i < 0) return { error: `The first row must have a "${names[0]}" column.` };
    at[key] = i;
  }
  const rows: Record<string, string>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const r = Object.fromEntries(Object.entries(at).map(([k, i]) => [k, text(row.getCell(i).value)]));
    if (Object.values(r).some(Boolean)) rows.push(r);
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
