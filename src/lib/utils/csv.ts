// Minimal CSV encode/decode helpers, shared by the faculty bulk-import page and
// the full-detail faculty export.

// Parses a real .xlsx workbook's first sheet into the same string[][] shape
// parseCSV produces, so uploaders can feed either format into one pipeline
// (matchHeaders, blank-row filtering, etc.) without knowing which was used.
// Parsing happens server-side (POST /api/college/parse-excel, real Node
// exceljs) rather than in the browser - exceljs ships a separate browser
// bundle for client use that has proven unreliable at reading files (it's
// fine for the exports elsewhere in the app, which only ever write).
export async function parseExcelFile(file: File): Promise<string[][]> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/college/parse-excel", { method: "POST", body: formData });
  const json = await res.json() as { rows?: string[][]; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Failed to parse Excel file");
  return json.rows ?? [];
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve((ev.target?.result as string) ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function toCSV(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => (cell.includes(",") || cell.includes('"') ? `"${cell.replace(/"/g, '""')}"` : cell)).join(","))
    .join("\r\n");
}

export function parseCSV(text: string): string[][] {
  const result: string[][] = [];
  // Strip a leading UTF-8 BOM - Excel prepends one when a CSV is re-saved as
  // "CSV UTF-8", which otherwise corrupts the first header cell and breaks
  // column matching (e.g. "﻿Employee ID" no longer equals "Employee ID").
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = stripped.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let inQuotes = false;
    let cell = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cell += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === "," && !inQuotes) {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += ch;
      }
    }
    cells.push(cell.trim());
    result.push(cells);
  }
  return result;
}

// Loosens header text for matching: case, punctuation, extra whitespace, and
// parenthetical hints (e.g. "Joining Date (YYYY-MM-DD)" → "joining date") no
// longer prevent a column from matching its template label.
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Like normalizeHeader, but keeps parenthetical content (just tidies case/
// spacing/stray punctuation inside it) instead of stripping it outright.
// Needed as a first, more precise matching pass: two columns whose only
// difference is their parenthetical qualifier - e.g. "Name (as per PAN)" vs
// "Name (as per Aadhar)" vs "Full Name (as per SSC)" - collapse to the same
// (or a colliding) string once normalizeHeader strips "(...)", which silently
// misroutes one column's data into another's. Matching against the
// downloaded template's actual header text (the overwhelmingly common case)
// never needs that stripping in the first place.
function normalizeHeaderExact(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9() ]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Matches uploaded CSV headers to template columns, tolerant of case,
 * punctuation, spacing, and (as a fallback only - see normalizeHeaderExact)
 * parenthetical hint text (e.g. "(YYYY-MM-DD)"). `aliases` lets a column also
 * match alternate wording (e.g. "Emp ID" → employeeId). Returns a map of
 * header column-index → matched column key; headers with no match are simply
 * left out, so their data is dropped rather than blocking the import.
 */
export function matchHeaders(
  headers: string[],
  columns: { key: string; label: string; aliases?: string[] }[]
): Record<number, string> {
  const byExact = new Map<string, string>();
  const byFuzzy = new Map<string, string>();
  // A column's own label is registered (in both maps) before any column's
  // aliases, and never overwritten once set - so a real label match always
  // wins over another column's alias landing on the same normalized string,
  // and the first-defined column wins a genuine label-vs-label collision in
  // the fuzzy map (exact matching resolves those correctly whenever the
  // uploaded header is the template's own text, which is the case that
  // actually matters).
  const register = (map: Map<string, string>, normalized: string, key: string) => {
    if (normalized && !map.has(normalized)) map.set(normalized, key);
  };
  for (const col of columns) {
    register(byExact, normalizeHeaderExact(col.label), col.key);
    register(byFuzzy, normalizeHeader(col.label), col.key);
  }
  for (const col of columns) {
    for (const alias of col.aliases ?? []) {
      register(byExact, normalizeHeaderExact(alias), col.key);
      register(byFuzzy, normalizeHeader(alias), col.key);
    }
  }
  const keyMap: Record<number, string> = {};
  headers.forEach((h, i) => {
    const key = byExact.get(normalizeHeaderExact(h)) ?? byFuzzy.get(normalizeHeader(h));
    if (key) keyMap[i] = key;
  });
  return keyMap;
}

/**
 * Headers from the uploaded file that `matchHeaders` couldn't map to any
 * template column. Callers that want a strict import (reject the file rather
 * than silently drop unrecognized columns) should check this list is empty
 * before accepting the parsed rows - see e.g. the faculty/supporting-staff/
 * students/departments import pages.
 */
export function getUnmatchedHeaders(headers: string[], keyMap: Record<number, string>): string[] {
  return headers
    .map((h, i) => (h.trim() && !keyMap[i] ? h.trim() : null))
    .filter((h): h is string => h !== null);
}

export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
