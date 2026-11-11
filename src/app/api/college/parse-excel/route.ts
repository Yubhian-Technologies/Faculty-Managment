export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { MAX_EXCEL_BYTES, loadWorkbook, readSheet } from "@/lib/excel/readWorkbook";

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
    // EXAM_CELL - its semester results import (exam-cell/semester-results).
    await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_OFFICE", "ACADEMICS", "LIBRARY", "EXAM_CELL");

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_EXCEL_BYTES) {
      return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
    }

    const workbook = await loadWorkbook(await file.arrayBuffer());

    // allSheets=1: every non-empty sheet, by name (one section per sheet, e.g. an attendance register).
    // The default stays the first sheet only, exactly as before.
    if (formData.get("allSheets") === "1") {
      const sheets = workbook.worksheets.map((s) => ({ name: s.name, ...readSheet(s) })).filter((s) => s.rows.length > 0);
      return NextResponse.json({ sheets });
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return NextResponse.json({ rows: [], rowNumbers: [] });
    }
    return NextResponse.json(readSheet(sheet));
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/parse-excel POST]", err);
    return NextResponse.json({ error: "Failed to parse the Excel file. Ensure it is a valid, uncorrupted .xlsx file." }, { status: 400 });
  }
}
