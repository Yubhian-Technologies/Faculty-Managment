export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { College } from "@/types";

// Read-only: lets faculty/HOD/Principal/Vice Principal see the geofence they
// need to be inside before attempting check-in, without exposing the rest of
// the college record (name, contact details, etc.) that GET /api/admin/colleges
// returns and that only Super Admin/Administration/Finance-type roles can reach.
export async function GET() {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "COLLEGE_STAFF", "EXAM_CELL");
    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).get();
    const college = snap.data() as College | undefined;
    return NextResponse.json({ campusLocation: college?.campusLocation ?? null });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance/campus-location GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
