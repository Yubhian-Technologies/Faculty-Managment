export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { fyFrom, taxRefs } from "@/lib/payroll/taxServer";
import { listPayEmployees, payrollErrorResponse, requirePayrollReader } from "@/lib/payroll/server";

// The year's paid salaries from the ledger (released months only), per person and month - for the
// annual salary register (Accounts + College Office).

export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollReader(db, request);
    const fy = fyFrom(request);
    const [led, employees] = await Promise.all([taxRefs(db, session.collegeId).ledger.where("fy", "==", fy).get(), listPayEmployees(db, session.collegeId)]);
    const who = new Map(employees.map((e) => [e.employeeKey, e]));
    const rows = led.docs.map((d) => d.data() as { employeeKey: string; month: string; payDays: number; gross: number; pf: number; pt: number; tds: number; advance: number; net: number; deductions: Record<string, number> })
      .map((l) => {
        const e = who.get(l.employeeKey);
        return { ...l, employeeCode: e?.employeeCode ?? "", name: e?.name ?? l.employeeKey, department: e?.department ?? "", section: e?.section ?? "TEACHING", pan: e?.extra.pan ?? "" };
      });
    return NextResponse.json({ fy, rows });
  } catch (err) {
    if (err instanceof Error && err.message === "BAD_FY") return NextResponse.json({ error: "Enter the financial year as YYYY-YY, for example 2026-27." }, { status: 400 });
    return payrollErrorResponse(err, "[college/payroll/reports/annual GET]");
  }
}
