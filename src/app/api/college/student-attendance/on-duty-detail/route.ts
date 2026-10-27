export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { failure } from "@/lib/studentPermissions/http";
import { onDutyDetailsFor } from "@/lib/studentPermissions/onDutyDetail";

// GET ?studentId=&date=YYYY-MM-DD[&periodNumber=n]
// Why a student shows "On Duty": the approved permission's title and who approved it. Read-only.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE");
    const q = new URL(request.url).searchParams;
    const studentId = q.get("studentId") ?? "";
    const date = q.get("date") ?? "";
    const period = q.get("periodNumber");
    const periodNumber = period ? Number(period) : undefined;
    if (!studentId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (periodNumber !== undefined && !Number.isInteger(periodNumber))) {
      return NextResponse.json({ error: "studentId and a valid date are required" }, { status: 400 });
    }
    return NextResponse.json({ details: await onDutyDetailsFor(getAdminDb(), session.collegeId, date, studentId, periodNumber) });
  } catch (err) {
    return failure(err, "college/student-attendance/on-duty-detail GET");
  }
}
