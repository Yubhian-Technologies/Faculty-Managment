// Minimal CSV encode/decode helpers, shared by the faculty bulk-import page and
// the full-detail faculty export.

export function toCSV(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => (cell.includes(",") || cell.includes('"') ? `"${cell.replace(/"/g, '""')}"` : cell)).join(","))
    .join("\r\n");
}

export function parseCSV(text: string): string[][] {
  const result: string[][] = [];
  // Strip a leading UTF-8 BOM — Excel prepends one when a CSV is re-saved as
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

/**
 * Matches uploaded CSV headers to template columns, tolerant of case,
 * punctuation, spacing, and parenthetical hint text (e.g. "(YYYY-MM-DD)").
 * `aliases` lets a column also match alternate wording (e.g. "Emp ID" → employeeId).
 * Returns a map of header column-index → matched column key; headers with no
 * match are simply left out, so their data is dropped rather than blocking the import.
 */
export function matchHeaders(
  headers: string[],
  columns: { key: string; label: string; aliases?: string[] }[]
): Record<number, string> {
  const byNormalizedLabel = new Map<string, string>();
  for (const col of columns) {
    byNormalizedLabel.set(normalizeHeader(col.label), col.key);
    for (const alias of col.aliases ?? []) {
      byNormalizedLabel.set(normalizeHeader(alias), col.key);
    }
  }
  const keyMap: Record<number, string> = {};
  headers.forEach((h, i) => {
    const key = byNormalizedLabel.get(normalizeHeader(h));
    if (key) keyMap[i] = key;
  });
  return keyMap;
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
