import mammoth from "mammoth";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { GridCell, ParsedGrid } from "@/lib/timetable/import/gridTypes";

function cellText($: cheerio.CheerioAPI, td: AnyNode): string {
  // Preserve intentional line breaks (a cell like "Data Structures<br>Dr. Rao"
  // or two separate <p> paragraphs) before flattening to plain text - without
  // this, cheerio's .text() would glue both halves into one unsplittable word.
  const el = $(td).clone();
  el.find("br").replaceWith("\n");
  const paragraphs = el.find("p").toArray().map((p) => $(p).text());
  const raw = paragraphs.length > 0 ? paragraphs.join("\n") : el.text();
  return raw
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, i, arr) => line.length > 0 || i < arr.length - 1)
    .join("\n")
    .trim();
}

/**
 * Converts an HTML document's largest table into a virtual grid, resolving
 * rowspan/colspan the same way a browser would lay the table out - so a
 * merged lab-block cell lands at the one (row, col) it visually starts at,
 * and every cell under it points back to that same entry. Split out from
 * parseWordTable so this layout logic can be exercised directly against
 * plain HTML fixtures in tests, without going through mammoth's real .docx
 * conversion each time.
 */
export function parseHtmlTable(html: string): ParsedGrid {
  const $ = cheerio.load(html);
  const tables = $("table").toArray();
  if (tables.length === 0) {
    throw new Error("No table was found in this document - the timetable must be laid out as a table.");
  }

  // A timetable is virtually always the largest table on the page (title
  // blocks, signatures, etc. are small tables, if they're tables at all).
  let best = tables[0];
  let bestCellCount = -1;
  for (const table of tables) {
    const count = $(table).find("td, th").length;
    if (count > bestCellCount) {
      bestCellCount = count;
      best = table;
    }
  }

  const rows = $(best).find("tr").toArray();
  const occupied: boolean[][] = [];
  const isOccupied = (r: number, c: number) => occupied[r]?.[c] === true;
  const markOccupied = (r: number, c: number) => {
    if (!occupied[r]) occupied[r] = [];
    occupied[r][c] = true;
  };

  const cells: GridCell[] = [];
  let colCount = 0;
  rows.forEach((tr, rowIndex) => {
    let col = 0;
    $(tr).find("> td, > th").each((_, td) => {
      while (isOccupied(rowIndex, col)) col++;
      const rowSpan = Number($(td).attr("rowspan") ?? 1) || 1;
      const colSpan = Number($(td).attr("colspan") ?? 1) || 1;
      cells.push({ row: rowIndex, col, rowSpan, colSpan, text: cellText($, td) });
      for (let r = rowIndex; r < rowIndex + rowSpan; r++) {
        for (let c = col; c < col + colSpan; c++) markOccupied(r, c);
      }
      col += colSpan;
      colCount = Math.max(colCount, col);
    });
  });

  return { rowCount: rows.length, colCount, cells };
}

/** Converts a .docx buffer's largest table into a virtual grid - see parseHtmlTable. */
export async function parseWordTable(buffer: Buffer): Promise<ParsedGrid> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  return parseHtmlTable(html);
}
