export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";

async function loadTargetInScope(
  db: FirebaseFirestore.Firestore,
  session: { collegeId: string; role: string; uid: string },
  uid: string
) {
  const targetSnap = await db
    .collection("colleges")
    .doc(session.collegeId)
    .collection("users")
    .doc(uid)
    .get();

  if (!targetSnap.exists) return { targetSnap: null, error: "User not found" as const, status: 404 };

  const target = targetSnap.data() as { role: string; department?: string };

  if (session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL") {
    if (!["HOD", "COLLEGE_OFFICE", "VICE_PRINCIPAL", "PANEL_MEMBER"].includes(target.role)) {
      return { targetSnap: null, error: "Cannot access this user", status: 403 };
    }
  } else if (session.role === "HOD") {
    if (target.role !== "PANEL_MEMBER") {
      return { targetSnap: null, error: "HOD can only manage Panel Members", status: 403 };
    }
    const hodSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("users")
      .doc(session.uid)
      .get();
    const hodDept = (hodSnap.data() as { department?: string } | undefined)?.department ?? "";
    if (hodDept && target.department !== hodDept) {
      return { targetSnap: null, error: "Can only manage faculty in your department", status: 403 };
    }
  }

  return { targetSnap, error: null, status: 200 };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD");
    const { uid } = await params;
    const db = getAdminDb();

    const { targetSnap, error, status } = await loadTargetInScope(db, session, uid);
    if (!targetSnap) return NextResponse.json({ error }, { status });

    return NextResponse.json({ user: { uid: targetSnap.id, ...targetSnap.data() } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/users/[uid] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD");
    const { uid } = await params;
    const body = (await request.json()) as Partial<{
      isActive: boolean;
      name: string;
      email: string;
      collegeEmail: string;
      employeeId: string;
      department: string;
      phone: string;
      academicProfile: Record<string, unknown>;
      profilePhotoUrl: string;
    }> & PersonalDetailsInput;

    const db = getAdminDb();

    const { targetSnap, error, status } = await loadTargetInScope(db, session, uid);
    if (!targetSnap) return NextResponse.json({ error }, { status });
    const target = targetSnap.data() as { role: string };

    // Empty string clears the photo — everything else must be a real upload of ours.
    if (
      body.profilePhotoUrl !== undefined &&
      body.profilePhotoUrl !== "" &&
      (!body.profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/") ||
        !body.profilePhotoUrl.includes(encodeURIComponent(`profile-photos/${uid}_`)))
    ) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now, ...buildPersonalDetailsUpdate(body) };

    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.name !== undefined && body.name.trim()) updates.name = body.name.trim();
    if (body.email !== undefined && body.email.trim()) updates.email = body.email.trim();
    if (body.collegeEmail !== undefined) updates.collegeEmail = body.collegeEmail;
    if (body.employeeId !== undefined) updates.employeeId = body.employeeId;
    if (body.department !== undefined) updates.department = body.department;
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.academicProfile !== undefined) updates.academicProfile = body.academicProfile;
    if (body.profilePhotoUrl !== undefined) updates.profilePhotoUrl = body.profilePhotoUrl;

    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("users")
      .doc(uid)
      .update(updates);

    // Keep systemUsers in sync (name/photo are the only fields mirrored there)
    if ((body.name !== undefined && body.name.trim()) || body.profilePhotoUrl !== undefined) {
      await db.collection("systemUsers").doc(uid).set(
        {
          ...(body.name !== undefined && body.name.trim() ? { name: body.name.trim() } : {}),
          ...(body.profilePhotoUrl !== undefined ? { profilePhotoUrl: body.profilePhotoUrl } : {}),
        },
        { merge: true }
      );
    }

    const action = body.isActive === false ? "USER_DEACTIVATED" : body.isActive === true ? "USER_REACTIVATED" : "USER_UPDATED";
    let actorName = "Unknown";
    try {
      const actorSnap = await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("users")
        .doc(session.uid)
        .get();
      actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    } catch { /* best-effort */ }

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action,
      performedBy: session.uid,
      performedByName: actorName,
      targetId: uid,
      details: { role: target.role },
      timestamp: now,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/users/[uid] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
