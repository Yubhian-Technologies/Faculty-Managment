export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";

const FINANCIAL_ACADEMIC_KEYS = ["presentSalary", "grossAnnualCTC", "incrementsAwarded", "fundingConsultancyRevenue"];

// Self-service lookup for "My Profile" pages. Two different data shapes can hold
// "this person's own details" depending on how their account was provisioned:
//  - PANEL_MEMBER (hired through the Faculty Register) gets a THIN login doc at
//    colleges/{id}/users/{uid} plus a separate, richer FacultyMember record
//    (colleges/{id}/facultyMembers/{facultyId}) linked back via userUid.
//  - HOD/PRINCIPAL/VICE_PRINCIPAL (provisioned via POST /api/college/users) have
//    no separate FacultyMember record at all - their academicProfile and personal
//    details live directly ON their own colleges/{id}/users/{uid} doc.
// So: try the FacultyMember link first, and only fall back to the caller's own
// user doc if that comes up empty - that fallback is what makes HOD/Principal
// "My Profile" show anything beyond name/email/role.
export async function GET() {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "COLLEGE_STAFF", "DEAN", "IQAC_COORDINATOR",
      "T_AND_P", "R_AND_D", "PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL", "WEBMASTER"
    );

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

// Self-service PATCH for PANEL_MEMBER - updates the facultyMembers doc (and syncs
// basic fields back to the thin users/{uid} doc so name/photo stay consistent).
// Employment fields (designation, department, joiningDate, employmentType, status,
// employeeId, collegeEmail) are never overwritten here - those belong to HR/admin.
export async function PATCH(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER");

    const body = (await request.json()) as Partial<{
      name: string;
      email: string;
      phone: string;
      academicProfile: Record<string, unknown>;
      profilePhotoUrl: string;
    }> & PersonalDetailsInput;

    if (
      body.profilePhotoUrl !== undefined &&
      body.profilePhotoUrl !== "" &&
      !body.profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/")
    ) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const facultySnap = await collegeRef
      .collection("facultyMembers")
      .where("userUid", "==", session.uid)
      .limit(1)
      .get();

    if (facultySnap.empty) {
      return NextResponse.json({ error: "Faculty record not found" }, { status: 404 });
    }

    const facultyDoc = facultySnap.docs[0];
    const now = new Date();

    const facultyUpdates: Record<string, unknown> = { updatedAt: now, ...buildPersonalDetailsUpdate(body) };
    if (body.name?.trim()) facultyUpdates.name = body.name.trim();
    if (body.email?.trim()) facultyUpdates.email = body.email.trim();
    if (body.phone !== undefined) facultyUpdates.phone = body.phone;
    if (body.profilePhotoUrl !== undefined) facultyUpdates.profilePhotoUrl = body.profilePhotoUrl;
    if (body.academicProfile !== undefined) {
      const ap = { ...body.academicProfile };
      for (const k of FINANCIAL_ACADEMIC_KEYS) delete ap[k];
      facultyUpdates.academicProfile = ap;
    }

    await facultyDoc.ref.update(facultyUpdates);

    // Keep the thin users/{uid} doc in sync so auth store reflects latest name/photo
    const userUpdates: Record<string, unknown> = { updatedAt: now };
    if (body.name?.trim()) userUpdates.name = body.name.trim();
    if (body.email?.trim()) userUpdates.email = body.email.trim();
    if (body.phone !== undefined) userUpdates.phone = body.phone;
    if (body.profilePhotoUrl !== undefined) userUpdates.profilePhotoUrl = body.profilePhotoUrl;
    await collegeRef.collection("users").doc(session.uid).update(userUpdates);

    if (body.name?.trim() || body.profilePhotoUrl !== undefined) {
      await db.collection("systemUsers").doc(session.uid).set(
        {
          ...(body.name?.trim() ? { name: body.name.trim() } : {}),
          ...(body.profilePhotoUrl !== undefined ? { profilePhotoUrl: body.profilePhotoUrl } : {}),
        },
        { merge: true }
      );
    }

    const facultyData = facultyDoc.data() as { name?: string };
    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "FACULTY_UPDATED",
      performedBy: session.uid,
      performedByName: facultyData.name ?? "Unknown",
      targetId: facultyDoc.id,
      details: { self: true },
      timestamp: now,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/me PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
