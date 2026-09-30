export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import ExcelJS from "exceljs";
import type { CellValue } from "exceljs";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB - matches the 500-row cap the import pages enforce

// Excel cells come back as strings, numbers, Dates, or rich objects (formula
// results, hyperlinks, rich text runs) depending on how the sheet was authored -
// normalize all of them to the plain strings the import pipeline expects, same
// convention as CSV text (dates as YYYY-MM-DD).
function cellToString(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((t) => t.text).join("");
    }
    if ("result" in value) return cellToString(value.result as CellValue);
    if ("text" in value) return String(value.text ?? "");
    return "";
  }
  return String(value).trim();
}

// Parses an uploaded .xlsx workbook's first sheet into rows of plain strings -
// run server-side (real Node exceljs) rather than in the browser, since
// exceljs's separate browser bundle has proven unreliable at reading files
// (works fine for the exports elsewhere in the app, which only ever write).
export async function POST(request: Request) {
  try {
    // Any college-scoped role that can reach a bulk-import page may parse a file here -
    // this endpoint only converts bytes to text rows, it never touches Firestore.
    // ACADEMICS - academics/subjects/import's own role (subjects/import
    // route.ts requires it) - was missing here, so an Academics user's
    // .xlsx upload 401'd on this shared parsing step while .csv (parsed
    // client-side, no round trip here) silently kept working.
    await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_OFFICE", "ACADEMICS", "LIBRARY");

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return NextResponse.json({ rows: [], rowNumbers: [] });
    }

    const rows: string[][] = [];
    // Each kept row's real sheet row number (1-based), parallel to `rows` -
    // blank rows are skipped above, so an importer that reports "Row N"
    // needs this to point at the row the user actually sees in Excel.
    const rowNumbers: number[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: string[] = [];
      for (let i = 1; i <= row.cellCount; i++) {
        cells.push(cellToString(row.getCell(i).value));
      }
      if (cells.some((c) => c.trim())) {
        rows.push(cells);
        rowNumbers.push(rowNumber);
      }
    });

    return NextResponse.json({ rows, rowNumbers });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/parse-excel POST]", err);
    return NextResponse.json({ error: "Failed to parse the Excel file. Ensure it is a valid, uncorrupted .xlsx file." }, { status: 400 });
  }
}
