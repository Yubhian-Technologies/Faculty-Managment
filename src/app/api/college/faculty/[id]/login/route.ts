export const dynamic = "force-dynamic";

import { firebaseAuthErrorResponse } from "@/lib/http/firebaseErrors";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { withAuthUser } from "@/lib/firebase/withAuthUser";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { getHodDepartmentScope, canHodManageFacultyDepartment } from "@/lib/departments/scope";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const { id } = await params;

    const body = (await readJsonBody(request)) as { email?: string; password?: string };
    const { email, password } = body;

    if (!email || !password || password.length < 8) {
      return NextResponse.json(
        { error: "Email and password (min 8 characters) are required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const ref = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("facultyMembers")
      .doc(id);

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Faculty not found" }, { status: 404 });
    }

    const data = snap.data() as { userUid?: string; legalName?: string; department?: string; profilePhotoUrl?: string };

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!data.department || !canHodManageFacultyDepartment(scope, data.department)) {
        return NextResponse.json(
          { error: "That faculty member is not in your department" },
          { status: 403 },
        );
      }
    }

    if (data.userUid) {
      return NextResponse.json(
        { error: "This faculty member already has a login account" },
        { status: 409 }
      );
    }

    // The login's display name is the faculty member's legalName (see facultyDisplayName()).
    const name = facultyDisplayName(data);
    const department = data.department ?? "";
    const profilePhotoUrl = data.profilePhotoUrl;

    // Create the Firebase Auth user and every document that goes with it as one
    // unit (withAuthUser): one batch for the writes, and the Auth user is removed
    // again if anything fails, so a failed attempt never leaves an orphan login.
    const now = new Date();
    const uid = await withAuthUser({ email, password, displayName: name, db }, async (newUid) => {
      const batch = db.batch();
      // Login account
      batch.set(db.collection("colleges").doc(session.collegeId).collection("users").doc(newUid), {
        uid: newUid,
        collegeId: session.collegeId,
        name,
        email,
        role: "PANEL_MEMBER",
        department,
        ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      // Role mapping for session resolution
      batch.set(db.collection("systemUsers").doc(newUid), {
        uid: newUid,
        role: "PANEL_MEMBER",
        collegeId: session.collegeId,
        email,
        name,
        ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
      });
      // Link the login account back to the faculty record
      batch.update(ref, { userUid: newUid, updatedAt: now });
      await batch.commit();
      return newUid;
    });

    return NextResponse.json({ uid }, { status: 201 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err && typeof err === "object" && "code" in err && err.code === "auth/email-already-exists") {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    const authErr = firebaseAuthErrorResponse(err);
    if (authErr) return authErr;
    console.error("[faculty/[id]/login POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
