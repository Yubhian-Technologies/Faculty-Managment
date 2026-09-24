export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Update (details and/or activate/deactivate) a location-scoped user
// (HR_ADMIN / ADMIN_OFFICE / ACCOUNTS / LOCATION_DEPT_HEAD). SUPER_ADMIN and
// MANAGEMENT can act on any location (they don't carry a locationId of their
// own - it comes from the request body instead); ADMINISTRATION (Location
// Admin) is scoped to only its own location, same authorization shape as
// this collection's own POST route.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    const session = await requireRole("SUPER_ADMIN", "MANAGEMENT", "ADMINISTRATION");

    const { uid } = await params;
    const body = (await request.json()) as {
      locationId?: string;
      isActive?: boolean;
      name?: string;
      email?: string;
      locationDeptId?: string;
      // For HR_ADMIN/ADMIN_OFFICE/ACCOUNTS only - see FMSUser's own doc-comment.
      locationDeptIds?: string[];
      allLocationDepts?: boolean;
    };
    const { locationId, isActive, name, email, locationDeptId, locationDeptIds, allLocationDepts } = body;

    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }
    if (session.role === "ADMINISTRATION" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Cannot manage users for another location" }, { status: 403 });
    }
    if (
      isActive === undefined && name === undefined && email === undefined && locationDeptId === undefined &&
      locationDeptIds === undefined && allLocationDepts === undefined
    ) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const db = getAdminDb();
    const userRef = db.collection("locations").doc(locationId).collection("locationUsers").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const existing = userSnap.data() as { role?: string; locationDeptId?: string; name?: string };

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (isActive !== undefined) updates.isActive = isActive;
    if (name !== undefined && name.trim()) updates.name = name.trim();
    if (email !== undefined && email.trim()) updates.email = email.trim();
    // Re-pointing a Dept Head to a different department - only meaningful
    // for that role; clears the old department's deptHeadUid/deptHeadName
    // below and sets the new one's, so a department never shows a stale head.
    if (locationDeptId !== undefined && existing.role === "LOCATION_DEPT_HEAD") {
      updates.locationDeptId = locationDeptId;
    }
    // Only meaningful for HR_ADMIN/ADMIN_OFFICE/ACCOUNTS - see the POST
    // route's own comment on why these two are ignored for a Dept Head.
    if ((locationDeptIds !== undefined || allLocationDepts !== undefined) && existing.role !== "LOCATION_DEPT_HEAD") {
      updates.allLocationDepts = !!allLocationDepts;
      updates.locationDeptIds = allLocationDepts ? [] : (locationDeptIds ?? []);
    }

    await userRef.set(updates, { merge: true });

    // Keep systemUsers (session-role resolution) in sync for whatever changed.
    const systemUpdates: Record<string, unknown> = {};
    if (name !== undefined && name.trim()) systemUpdates.name = name.trim();
    if (email !== undefined && email.trim()) systemUpdates.email = email.trim();
    if (Object.keys(systemUpdates).length > 0) {
      await db.collection("systemUsers").doc(uid).set(systemUpdates, { merge: true });
    }

    if (
      existing.role === "LOCATION_DEPT_HEAD" &&
      locationDeptId !== undefined &&
      locationDeptId !== existing.locationDeptId
    ) {
      const deptsRef = db.collection("locations").doc(locationId).collection("locationDepts");
      if (existing.locationDeptId) {
        await deptsRef.doc(existing.locationDeptId).set({ deptHeadUid: null, deptHeadName: null, updatedAt: new Date() }, { merge: true });
      }
      if (locationDeptId) {
        await deptsRef.doc(locationDeptId).set({ deptHeadUid: uid, deptHeadName: name?.trim() || existing.name || "", updatedAt: new Date() }, { merge: true });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/users/[uid] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Permanently removes a location-scoped user: the Firestore locationUsers
// doc, its systemUsers mirror, its department's deptHeadUid/deptHeadName if
// it was that department's head (otherwise the department would keep
// pointing at a uid that no longer resolves to anyone), and (best-effort)
// the Firebase Auth account itself. Same role/location scoping as PATCH.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    const session = await requireRole("SUPER_ADMIN", "MANAGEMENT", "ADMINISTRATION");

    const { uid } = await params;
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") ?? "";
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }
    if (session.role === "ADMINISTRATION" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Cannot manage users for another location" }, { status: 403 });
    }

    const db = getAdminDb();
    const userRef = db.collection("locations").doc(locationId).collection("locationUsers").doc(uid);
    const userSnap = await userRef.get();
    const existing = userSnap.data() as { role?: string; locationDeptId?: string } | undefined;

    await userRef.delete();
    await db.collection("systemUsers").doc(uid).delete();

    if (existing?.role === "LOCATION_DEPT_HEAD" && existing.locationDeptId) {
      await db.collection("locations").doc(locationId).collection("locationDepts").doc(existing.locationDeptId)
        .set({ deptHeadUid: null, deptHeadName: null, updatedAt: new Date() }, { merge: true });
    }

    // Best-effort: Firestore cleanup above already succeeded either way, so a
    // failure here just leaves an orphaned Auth account rather than blocking
    // the delete - same tradeoff as the Super Admin users route's own DELETE.
    try {
      const { getAdminAuth } = await import("@/lib/firebase/admin");
      const auth = await getAdminAuth();
      await auth.deleteUser(uid);
    } catch (authErr) {
      console.warn("[location/users/[uid] DELETE] Auth deletion failed (non-fatal):", authErr);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/users/[uid] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
