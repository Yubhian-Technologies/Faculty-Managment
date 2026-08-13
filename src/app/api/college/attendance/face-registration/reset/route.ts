export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";

// Lets an HOD send a same-department Faculty member back to "not registered"
// for facial attendance — clears the stored embedding (never deletes the
// facultyMembers record itself) so that faculty's next visit to My
// Attendance shows the exact same Register prompt/capture flow as first-time
// registration. This route never captures a face itself and never touches
// the HOD-managed profilePhotoUrl — the actual re-registration still happens
// entirely on the Faculty's own device via the unchanged existing flow (see
// /api/college/attendance/face-registration POST, which the Faculty's next
// registration overwrites this same field with — never a duplicate record).
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD");
    const body = (await request.json()) as { facultyId?: string };
    const facultyId = body.facultyId;
    if (!facultyId) {
      return NextResponse.json({ error: "Faculty is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

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
