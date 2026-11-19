export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadHodSemester, loadHodToday } from "@/lib/dashboard/hodDashboardServer";

// HOD dashboard figures, limited to the HOD's own department tree (lib/dashboard/hodDashboardServer.ts).
//   ?part=today     classes grid, student attendance today per section, on leave today (read fresh)
//   ?part=semester  attendance trend, shortage, latest results (kept 10 minutes; &fresh=1 recomputes)
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD");
    const { searchParams } = new URL(request.url);
    const part = searchParams.get("part");
    const db = getAdminDb();
    if (part === "today") return NextResponse.json(await loadHodToday(db, session.collegeId, session.uid));
    if (part === "semester") return NextResponse.json(await loadHodSemester(db, session.collegeId, session.uid, searchParams.get("fresh") === "1"));
    return NextResponse.json({ error: "Select what to load (today or semester)." }, { status: 400 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/hod/dashboard GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
