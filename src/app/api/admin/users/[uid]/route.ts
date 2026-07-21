export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import type { UserRole } from "@/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    await requireSuperAdmin();

    const { uid } = await params;
    const { searchParams } = new URL(request.url);
    const collegeId = searchParams.get("collegeId");
    if (!collegeId) {
      return NextResponse.json({ error: "collegeId required" }, { status: 400 });
    }

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user: { uid: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/users/[uid] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    await requireSuperAdmin();

    const { uid } = await params;
    const body = (await request.json()) as {
      collegeId: string;
      role?: UserRole;
      isActive?: boolean;
      department?: string;
      name?: string;
      email?: string;
      collegeEmail?: string;
      employeeId?: string;
      phone?: string;
      academicProfile?: Record<string, unknown>;
    } & PersonalDetailsInput;

    const { collegeId, role, isActive, department, name, email, collegeEmail, employeeId, phone, academicProfile } = body;

    if (!collegeId) {
      return NextResponse.json({ error: "collegeId required" }, { status: 400 });
    }

    const db = getAdminDb();
    const updates: Record<string, unknown> = { updatedAt: new Date(), ...buildPersonalDetailsUpdate(body) };

    if (role !== undefined) updates.role = role;
    if (isActive !== undefined) updates.isActive = isActive;
    if (department !== undefined) updates.department = department;
    if (name !== undefined && name.trim()) updates.name = name.trim();
    if (email !== undefined && email.trim()) updates.email = email.trim();
    if (collegeEmail !== undefined) updates.collegeEmail = collegeEmail;
    if (employeeId !== undefined) updates.employeeId = employeeId;
    if (phone !== undefined) updates.phone = phone;
    if (academicProfile !== undefined) updates.academicProfile = academicProfile;

    await db
      .collection("colleges")
      .doc(collegeId)
      .collection("users")
      .doc(uid)
      .set(updates, { merge: true });

    // Keep systemUsers in sync for session-role resolution
    const systemUpdates: Record<string, unknown> = {};
    if (role !== undefined) systemUpdates.role = role;
    if (name !== undefined && name.trim()) systemUpdates.name = name.trim();
    if (Object.keys(systemUpdates).length > 0) {
      await db.collection("systemUsers").doc(uid).set(systemUpdates, { merge: true });
    }

    const action =
      isActive === false ? "USER_DEACTIVATED" : isActive === true ? "USER_REACTIVATED" : "USER_UPDATED";

    await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
      collegeId,
      action,
      performedBy: "SUPER_ADMIN",
      performedByName: "Super Admin",
      targetId: uid,
      details: {
        ...(role !== undefined && { role }),
        ...(isActive !== undefined && { isActive }),
        ...(department !== undefined && { department }),
        ...(name !== undefined && { name }),
      },
      timestamp: new Date(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/users/[uid] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    await requireSuperAdmin();

    const { uid } = await params;
    const db = getAdminDb();

    // Prefer the collegeId the caller already knows (e.g. from the scoped list
    // it fetched the user from) — systemUsers can be missing/stale for users
    // created outside the normal creation flow, which previously left the
    // college-scoped user doc undeleted while still reporting success.
    const { searchParams } = new URL(request.url);
    const explicitCollegeId = searchParams.get("collegeId") ?? "";

    const sysSnap = await db.collection("systemUsers").doc(uid).get();
    const sysData = sysSnap.data() as { collegeId?: string; email?: string } | undefined;
    const collegeId = explicitCollegeId || sysData?.collegeId || "";
    const userEmail = sysData?.email ?? "";

    // Delete from Firestore first (always succeeds)
    if (collegeId) {
      await db.collection("colleges").doc(collegeId).collection("users").doc(uid).delete();
    }
    await db.collection("systemUsers").doc(uid).delete();

    // Best-effort: delete from Firebase Auth via Admin SDK
    // If it fails we still return success — the user is deactivated in Firestore
    try {
      const { getAdminAuth } = await import("@/lib/firebase/admin");
      const auth = await getAdminAuth();
      await auth.deleteUser(uid);
    } catch (authErr) {
      console.warn("[admin/users/[uid] DELETE] Auth deletion failed (non-fatal):", authErr);
    }

    if (collegeId) {
      await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
        collegeId,
        action: "USER_DELETED",
        performedBy: "SUPER_ADMIN",
        performedByName: "Super Admin",
        targetId: uid,
        details: { email: userEmail },
        timestamp: new Date(),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/users/[uid] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
