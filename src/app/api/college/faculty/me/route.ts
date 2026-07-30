export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Self-service lookup for "My Profile" pages. Two different data shapes can hold
// "this person's own details" depending on how their account was provisioned:
//  - PANEL_MEMBER (hired through the Faculty Register) gets a THIN login doc at
//    colleges/{id}/users/{uid} plus a separate, richer FacultyMember record
//    (colleges/{id}/facultyMembers/{facultyId}) linked back via userUid — see
//    loadFacultyDefaults in leave/profile's route for the same lookup pattern.
//  - HOD/PRINCIPAL/VICE_PRINCIPAL (provisioned via POST /api/college/users) have
//    no separate FacultyMember record at all — their academicProfile and personal
//    details live directly ON their own colleges/{id}/users/{uid} doc.
// So: try the FacultyMember link first, and only fall back to the caller's own
// user doc if that comes up empty — that fallback is what makes HOD/Principal
// "My Profile" show anything beyond name/email/role.
export async function GET() {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL");

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const facultySnap = await collegeRef
      .collection("facultyMembers")
      .where("userUid", "==", session.uid)
      .limit(1)
      .get();

    if (!facultySnap.empty) {
      const facultyDoc = facultySnap.docs[0];
      const assignmentsSnap = await collegeRef
        .collection("teachingAssignments")
        .where("facultyId", "==", facultyDoc.id)
        .get();

      return NextResponse.json({
        faculty: { id: facultyDoc.id, ...facultyDoc.data() },
        teachingAssignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      });
    }

    const userSnap = await collegeRef.collection("users").doc(session.uid).get();
    if (!userSnap.exists) {
      return NextResponse.json({ faculty: null, teachingAssignments: [] });
    }

    return NextResponse.json({
      faculty: { id: userSnap.id, ...userSnap.data() },
      teachingAssignments: [],
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/me GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
