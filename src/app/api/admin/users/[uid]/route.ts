export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import type { UserRole } from "@/types";

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
      newPassword?: string;
      name?: string;
    };

    const { collegeId, role, isActive, department, newPassword, name } = body;

    if (!collegeId) {
      return NextResponse.json({ error: "collegeId required" }, { status: 400 });
    }

    const auth = await getAdminAuth();
    const db = getAdminDb();

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const authUpdates: Record<string, unknown> = {};

    if (role !== undefined) {
      updates.role = role;
      try {
        const existing = await auth.getUser(uid);
        const currentClaims = (existing.customClaims ?? {}) as Record<string, unknown>;
        await auth.setCustomUserClaims(uid, { ...currentClaims, role });
      } catch (authErr) {
        if ((authErr as { code?: string }).code === "auth/user-not-found") {
          return NextResponse.json({ error: "User not found" }, { status: 404 });
        }
        throw authErr;
      }
    }

    if (isActive !== undefined) {
      updates.isActive = isActive;
      authUpdates.disabled = !isActive;
    }

    if (department !== undefined) {
      updates.department = department;
    }

    if (name !== undefined && name.trim()) {
      updates.name = name.trim();
      authUpdates.displayName = name.trim();
    }

    if (newPassword !== undefined && newPassword.length >= 6) {
      authUpdates.password = newPassword;
    }

    if (Object.keys(authUpdates).length > 0) {
      try {
        await auth.updateUser(uid, authUpdates);
      } catch (authErr) {
        if ((authErr as { code?: string }).code === "auth/user-not-found") {
          return NextResponse.json({ error: "User not found" }, { status: 404 });
        }
        throw authErr;
      }
    }

    // Use set+merge so the call succeeds even if the Firestore doc
    // was never created (e.g. user exists in Auth but not Firestore)
    await db
      .collection("colleges")
      .doc(collegeId)
      .collection("users")
      .doc(uid)
      .set(updates, { merge: true });

    const action =
      isActive === false ? "USER_DEACTIVATED" : isActive === true ? "USER_REACTIVATED" : "USER_UPDATED";

    await db
      .collection("colleges")
      .doc(collegeId)
      .collection("auditLogs")
      .add({
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
          passwordReset: !!newPassword,
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
  _request: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    await requireSuperAdmin();

    const { uid } = await params;
    const db = getAdminDb();
    const auth = await getAdminAuth();

    let userEmail = "";
    let collegeId = "";
    try {
      const authUser = await auth.getUser(uid);
      userEmail = authUser.email ?? "";
      const claims = (authUser.customClaims ?? {}) as { collegeId?: string };
      collegeId = claims.collegeId ?? "";
    } catch {
      // user may not exist in Auth
    }

    await auth.deleteUser(uid);

    if (collegeId) {
      await db.collection("colleges").doc(collegeId).collection("users").doc(uid).delete();
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
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "auth/user-not-found"
    ) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    console.error("[admin/users/[uid] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
