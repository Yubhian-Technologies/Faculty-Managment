export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildOptions, AdjustmentError } from "@/lib/classAdjustments/server";
import { callerOf, errorResponse } from "@/lib/classAdjustments/routeHelpers";

// GET ?date=YYYY-MM-DD[&facultyId=] -> the faculty member's periods that day, each with the colleagues who teach
// that section (free or busy) and, for a swap, the colleague's periods in sections the faculty member teaches.
// `facultyId` of someone else: HOD only, and only for faculty of the HOD's departments.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const db = getAdminDb();
    const caller = await callerOf(db, session);
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? "";
    const asked = url.searchParams.get("facultyId") ?? "";
    let facultyId = caller.facultyId;
    if (asked && asked !== caller.facultyId) {
      if (!caller.hodDepartments.length) throw new AdjustmentError("Only an HOD can arrange a class for someone else.", 403);
      const f = await db.collection("colleges").doc(session.collegeId).collection("facultyMembers").doc(asked).get();
      if (!f.exists) throw new AdjustmentError("Faculty record not found. It may have been deleted.", 404);
      if (!caller.hodDepartments.includes((f.data() as { department?: string }).department ?? "")) {
        throw new AdjustmentError("This faculty member is not in your department.", 403);
      }
      facultyId = asked;
    }
    const { requester, periods, noClassReason } = await buildOptions(db, session.collegeId, facultyId, date);
    return NextResponse.json({ date, faculty: { id: requester.id, name: requester.name }, periods, noClassReason: noClassReason ?? null });
  } catch (err) {
    return errorResponse(err, "class-adjustments/options GET");
  }
}
