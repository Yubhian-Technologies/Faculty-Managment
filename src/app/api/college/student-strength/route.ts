export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { loadStrengthPayload } from "@/lib/students/strength/load";

// Student Strength: the aggregated cube (counts per program / branch / year /
// section / status / batch) generated live from the student records. Nothing
// is stored - see lib/students/strength/. The browser filters and totals the
// cube itself, so changing a filter needs no further request.
//
// Principal / Vice Principal (College Admin) / College Office / Super Admin
// see the whole college; an HOD sees the students their roster already shows
// them. Faculty (PANEL_MEMBER) and Library have no strength view.
export async function GET() {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const db = getAdminDb();

    const hodScope = session.role === "HOD" ? await getHodDepartmentScope(db, session.collegeId, session.uid) : undefined;
    const payload = await loadStrengthPayload(db, session.collegeId, { hodScope });

    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student-strength GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
