export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadAttendanceDashboard } from "@/lib/studentAttendance/dashboardServer";
import type { DashRange } from "@/lib/studentAttendance/dashboard";

// Student Attendance dashboard (lib/studentAttendance/dashboardServer.ts). HOD: their department tree (the same
// sections as the HOD dashboard and the reports); Principal / VP (College Admin normalized to Principal): the college.
//   ?range=semester|month|30d|custom (&from=&to= for custom, up to 186 days)  &department= &year= &sectionId=  &fresh=1
const RANGES: DashRange[] = ["semester", "month", "30d", "custom"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const q = new URL(request.url).searchParams;
    const range = (q.get("range") ?? "semester") as DashRange;
    if (!RANGES.includes(range)) return NextResponse.json({ error: "Select a valid period." }, { status: 400 });
    const from = q.get("from") ?? undefined, to = q.get("to") ?? undefined;
    if (range === "custom") {
      if (!from || !to || !ISO.test(from) || !ISO.test(to) || from > to) {
        return NextResponse.json({ error: "Select a From date on or before the To date." }, { status: 400 });
      }
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      if (days > 186) return NextResponse.json({ error: "Select up to six months at a time." }, { status: 400 });
    }
    const yearRaw = Number(q.get("year"));
    const who = session.role === "HOD" ? { kind: "hod" as const, uid: session.uid } : { kind: "college" as const };
    const body = await loadAttendanceDashboard(getAdminDb(), session.collegeId, who, {
      range,
      ...(range === "custom" ? { from, to } : {}),
      department: q.get("department") || undefined,
      year: Number.isInteger(yearRaw) && yearRaw > 0 ? yearRaw : undefined,
      sectionId: q.get("sectionId") || undefined,
    }, q.get("fresh") === "1");
    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/student-attendance/dashboard GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
