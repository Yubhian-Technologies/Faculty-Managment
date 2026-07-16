export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { UserRole } from "@/types";

// Super Admin may only set the photo / "Others" note for the roles it directly
// administers. Everyone else's photo is edited from their own manager's
// dashboard (Principal for HOD/Vice Principal, HOD for faculty) — Super Admin
// can still see those elsewhere, just not edit them from here.
const COLLEGE_ROLES: UserRole[] = ["PRINCIPAL", "ACCOUNTS", "FINANCE", "PURCHASE_DEPT"];
const LOCATION_ROLES: UserRole[] = ["ADMINISTRATION"];
const GLOBAL_ROLES: UserRole[] = ["MANAGEMENT"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    await requireSuperAdmin();
    const { uid } = await params;

    const body = (await request.json()) as {
      photoUrl?: string;
      otherInformation?: string;
      role?: UserRole;
      collegeId?: string;
      locationId?: string;
    };
    const { photoUrl, otherInformation, role, collegeId, locationId } = body;

    if (!role || (photoUrl === undefined && otherInformation === undefined)) {
      return NextResponse.json({ error: "role and photoUrl or otherInformation are required" }, { status: 400 });
    }
    if (
      photoUrl !== undefined &&
      (!photoUrl.startsWith("https://firebasestorage.googleapis.com/") ||
        !photoUrl.includes(encodeURIComponent(`profile-photos/${uid}_`)))
    ) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();

    const tenantUpdate: Record<string, unknown> = { updatedAt: now };
    if (photoUrl !== undefined) tenantUpdate.profilePhotoUrl = photoUrl;
    if (otherInformation !== undefined) tenantUpdate.academicProfile = { otherInformation };

    if (COLLEGE_ROLES.includes(role)) {
      if (!collegeId) return NextResponse.json({ error: "collegeId required for this role" }, { status: 400 });
      await db.collection("colleges").doc(collegeId).collection("users").doc(uid)
        .set(tenantUpdate, { merge: true });

      if (photoUrl !== undefined) {
        await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
          collegeId,
          action: "PROFILE_PHOTO_UPDATED",
          performedBy: "SUPER_ADMIN",
          performedByName: "Super Admin",
          targetId: uid,
          timestamp: now,
        });
      }
    } else if (LOCATION_ROLES.includes(role)) {
      if (!locationId) return NextResponse.json({ error: "locationId required for this role" }, { status: 400 });
      await db.collection("locations").doc(locationId).collection("locationUsers").doc(uid)
        .set(tenantUpdate, { merge: true });
    } else if (!GLOBAL_ROLES.includes(role)) {
      return NextResponse.json({ error: "Super Admin cannot edit this role" }, { status: 403 });
    }

    // systemUsers is the mirror every dashboard's nav/avatar reads from, regardless of scope.
    const systemUpdate: Record<string, unknown> = {};
    if (photoUrl !== undefined) systemUpdate.profilePhotoUrl = photoUrl;
    if (otherInformation !== undefined) systemUpdate.academicProfile = { otherInformation };
    if (Object.keys(systemUpdate).length > 0) {
      await db.collection("systemUsers").doc(uid).set(systemUpdate, { merge: true });
    }

    return NextResponse.json({ ok: true, photoUrl, otherInformation });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/users/[uid]/photo PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
