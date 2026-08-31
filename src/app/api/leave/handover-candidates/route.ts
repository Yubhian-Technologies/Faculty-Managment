export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";

// Same-department colleagues the caller can name as an optional handover/
// point-of-contact for a leave request (LeaveRequest.handoverToUid, see
// LeaveApplyForm.tsx) - open to any leave-applicant role, unlike
// GET /api/college/users which is admin-facing (Principal/HOD/Office/etc
// managing OTHER people's accounts), not "who's in my own department".
export async function GET() {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const db = getAdminDb();
    const department = await resolveUserDepartment(db, session.collegeId, session.uid);
    if (!department) return NextResponse.json({ candidates: [] });

    const snap = await db.collection("colleges").doc(session.collegeId)
      .collection("users").where("department", "==", department).get();

    // Handover is a staff-to-staff point-of-contact - never offer a Student
    // or Class Leader login even though both carry a `department` field.
    const candidates = snap.docs
      .filter((d) => d.id !== session.uid)
      .map((d) => ({ uid: d.id, ...(d.data() as { name?: string; role?: string }) }))
      .filter((c) => c.role !== "STUDENT" && c.role !== "CLASS_LEADER")
      .map((c) => ({ uid: c.uid, name: c.name ?? "Unknown" }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ candidates });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/handover-candidates GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
