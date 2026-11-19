export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadDashSemester, loadDashToday } from "@/lib/dashboard/hodDashboardServer";
import { loadFacultyMonth } from "@/lib/dashboard/principalDashboardServer";

// Principal / VP (and the College Admin, who signs in as Principal) dashboard figures for the whole college.
//   ?part=today        classes, student attendance today, on leave today, per department (kept 60 s)
//   ?part=semester     trend, shortage (per department and subject), latest results (kept 10 minutes; &fresh=1)
//   ?part=facultyMonth faculty attendance this month by department (kept 10 minutes)
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL");
    const { searchParams } = new URL(request.url);
    const part = searchParams.get("part");
    const db = getAdminDb();
    if (part === "today") return NextResponse.json(await loadDashToday(db, session.collegeId, { kind: "college" }));
    if (part === "semester") return NextResponse.json(await loadDashSemester(db, session.collegeId, { kind: "college" }, searchParams.get("fresh") === "1"));
    if (part === "facultyMonth") return NextResponse.json(await loadFacultyMonth(db, session.collegeId));
    return NextResponse.json({ error: "Select what to load (today, semester or facultyMonth)." }, { status: 400 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/principal/dashboard GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
