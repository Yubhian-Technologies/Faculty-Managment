export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL");
    const { id } = await params;

    const body = (await request.json()) as { email?: string; password?: string };
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

    const data = snap.data() as { userUid?: string; name?: string; department?: string };

    if (data.userUid) {
      return NextResponse.json(
        { error: "This faculty member already has a login account" },
        { status: 409 }
      );
    }

    const name = data.name ?? "";
    const department = data.department ?? "";

    // Create Firebase Auth user
    const uid = await createFirebaseUser(email, password, name);

    const now = new Date();

    // Write login account to users collection
    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("users")
      .doc(uid)
      .set({
        uid,
        collegeId: session.collegeId,
        name,
        email,
        role: "PANEL_MEMBER",
        department,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

    // Role mapping for session resolution
    await db.collection("systemUsers").doc(uid).set({
      uid,
      role: "PANEL_MEMBER",
      collegeId: session.collegeId,
      email,
      name,
    });

    // Link the login account back to the faculty record
    await ref.update({ userUid: uid, updatedAt: now });

    return NextResponse.json({ uid }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err && typeof err === "object" && "code" in err && err.code === "auth/email-already-exists") {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    console.error("[faculty/[id]/login POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
