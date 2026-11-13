export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { MAX_EXCEL_BYTES, loadWorkbook, readSheet } from "@/lib/excel/readWorkbook";
import { PayrollError, payrollErrorResponse, requirePayrollReader } from "@/lib/payroll/server";

// Reads an uploaded .xlsx (first sheet) into text rows for the payroll imports (pay, advances, tax paid
// so far). The shared /api/college/parse-excel is for college staff only, so location Accounts - who
// run these imports - got 401 there. Converts bytes to text only; writes nothing.

export async function POST(request: Request) {
  try {
    await requirePayrollReader(getAdminDb(), request);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new PayrollError("No file uploaded");
    if (file.size > MAX_EXCEL_BYTES) throw new PayrollError("File too large (max 10MB)");
    let workbook;
    try {
      workbook = await loadWorkbook(await file.arrayBuffer());
    } catch {
      throw new PayrollError("Unable to read the Excel file. Make sure it is a valid .xlsx file.");
    }
    const sheet = workbook.worksheets[0];
    return NextResponse.json(sheet ? readSheet(sheet) : { rows: [], rowNumbers: [] });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/parse-excel POST]");
  }
}
