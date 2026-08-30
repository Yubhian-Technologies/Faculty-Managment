export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { unitLabelForHeadRole, isCollegeStaffUnitHead, COLLEGE_STAFF_UNIT_HEAD_ROLES } from "@/lib/attendance/collegeStaffUnits";

// Sends someone back to "not registered" for facial attendance so their next
// visit to My Attendance shows the exact same Register prompt/capture flow as
// first-time registration — clears only the stored embedding, never the
// underlying record. This route never captures a face itself; the actual
// re-registration still happens entirely on that person's own device via the
// unchanged existing flow (see /api/college/attendance/face-registration
// POST, which their next registration overwrites this same field with —
// never a duplicate record).
//
// Two escalation tiers reset each other, mirroring the org hierarchy:
//   - HOD resets a same-department Faculty member (facultyMembers doc).
//   - PRINCIPAL/VICE_PRINCIPAL (equal authority - see manual/route.ts's
//     identical treatment of the two) resets an HOD or the other of
//     Principal/Vice Principal in their own college (users/{uid} doc —
//     HOD/Principal/VP have no FacultyMember record).
// Management resetting Principal is a separate route (Management's session
// isn't scoped to one college) — see
// /api/management/colleges/[collegeId]/principal-attendance/reset.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", ...COLLEGE_STAFF_UNIT_HEAD_ROLES);
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    if (isCollegeStaffUnitHead(session.role)) {
      // Unit head - resets a COLLEGE_STAFF member belonging to their own
      // unit (same department-string link as manual/route.ts and
      // attendance/route.ts).
      const body = (await request.json()) as { uid?: string };
      const uid = body.uid;
      if (!uid) {
        return NextResponse.json({ error: "Staff member is required" }, { status: 400 });
      }
      const targetSnap = await collegeRef.collection("users").doc(uid).get();
      if (!targetSnap.exists) {
        return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
      }
      const target = targetSnap.data() as { role?: string; department?: string };
      if (target.role !== "COLLEGE_STAFF" || target.department !== unitLabelForHeadRole(session.role)) {
        return NextResponse.json({ error: "You can only reset face registration for staff in your unit" }, { status: 403 });
      }
      await targetSnap.ref.update({
        faceEmbedding: FieldValue.delete(),
        faceRegisteredAt: FieldValue.delete(),
      });
      return NextResponse.json({ ok: true });
    }

    if (session.role !== "HOD") {
      const body = (await request.json()) as { uid?: string };
      const uid = body.uid;
      if (!uid) {
        return NextResponse.json({ error: "Staff member is required" }, { status: 400 });
      }

      const targetSnap = await collegeRef.collection("users").doc(uid).get();
      if (!targetSnap.exists) {
        return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
      }
      const target = targetSnap.data() as { role?: string };
      // Principal, Vice Principal, and College Admin (equal authority -
      // College Admin mirrors Principal's authority end-to-end, see UserRole's
      // own doc-comment; its session normalizes to "PRINCIPAL" but its own
      // target doc keeps the real "COLLEGE_ADMIN" role) reset each other
      // symmetrically, plus any of them can reset an HOD or a unit head -
      // mirrors manual/route.ts's identical PRINCIPAL/VICE_PRINCIPAL treatment
      // there.
      const validTargetRoles = ["PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_ADMIN", "HOD", ...COLLEGE_STAFF_UNIT_HEAD_ROLES];
      if (!target.role || !validTargetRoles.includes(target.role)) {
        return NextResponse.json(
          { error: "You can only reset face registration for an HOD, a unit head, or the Principal/Vice Principal" },
          { status: 403 }
        );
      }

      await targetSnap.ref.update({
        faceEmbedding: FieldValue.delete(),
        faceRegisteredAt: FieldValue.delete(),
      });

      return NextResponse.json({ ok: true });
    }

    const body = (await request.json()) as { facultyId?: string };
    const facultyId = body.facultyId;
    if (!facultyId) {
      return NextResponse.json({ error: "Faculty is required" }, { status: 400 });
    }

    const targetSnap = await collegeRef.collection("facultyMembers").doc(facultyId).get();
    if (!targetSnap.exists) {
      return NextResponse.json({ error: "Faculty not found" }, { status: 404 });
    }
    const target = targetSnap.data() as { department?: string; userUid?: string };

    const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
    if (!canHodEditDepartment(scope, target.department ?? "")) {
      return NextResponse.json(
        { error: "You can only reset face registration for faculty in your department" },
        { status: 403 }
      );
    }
    if (!target.userUid) {
      return NextResponse.json({ error: "This faculty member has no login account yet" }, { status: 400 });
    }

    await targetSnap.ref.update({
      faceEmbedding: FieldValue.delete(),
      faceRegisteredAt: FieldValue.delete(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance/face-registration/reset POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
