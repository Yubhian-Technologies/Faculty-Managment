export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireLocationMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Self-service "My Profile" for LOCATION-scoped roles (Administration, HR Admin,
// Admin Office, Location Dept Head, Accounts) - their identity lives at
// locations/{locationId}/locationUsers/{uid}, mirroring how college-scoped
// roles self-serve via /api/college/users/me.
const LOCATION_ROLES = ["ADMINISTRATION", "HR_ADMIN", "ADMIN_OFFICE", "LOCATION_DEPT_HEAD", "ACCOUNTS"];

export async function GET() {
  try {
    const session = await requireLocationMember(...LOCATION_ROLES);
    const db = getAdminDb();
    const locationRef = db.collection("locations").doc(session.locationId);
    const [snap, locationSnap] = await Promise.all([
      locationRef.collection("locationUsers").doc(session.uid).get(),
      locationRef.get(),
    ]);
    if (!snap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const locationName = (locationSnap.data() as { name?: string } | undefined)?.name ?? "";
    return NextResponse.json({ user: { uid: snap.id, ...snap.data() }, locationName });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_LOCATION_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/users/me GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireLocationMember(...LOCATION_ROLES);

    const body = (await request.json()) as Partial<{
      name: string;
      email: string;
      phone: string;
      profilePhotoUrl: string;
    }>;

    if (
      body.profilePhotoUrl !== undefined &&
      body.profilePhotoUrl !== "" &&
      !body.profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/")
    ) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    const db = getAdminDb();
    const userRef = db
      .collection("locations").doc(session.locationId)
      .collection("locationUsers").doc(session.uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (body.name !== undefined && body.name.trim()) updates.name = body.name.trim();
    if (body.email !== undefined && body.email.trim()) updates.email = body.email.trim();
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.profilePhotoUrl !== undefined) updates.profilePhotoUrl = body.profilePhotoUrl;

    await userRef.update(updates);

    // Keep the systemUsers pointer in sync so name/photo reflect immediately in the auth store.
    if ((body.name !== undefined && body.name.trim()) || body.profilePhotoUrl !== undefined) {
      await db.collection("systemUsers").doc(session.uid).set(
        {
          ...(body.name !== undefined && body.name.trim() ? { name: body.name.trim() } : {}),
          ...(body.profilePhotoUrl !== undefined ? { profilePhotoUrl: body.profilePhotoUrl } : {}),
        },
        { merge: true }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_LOCATION_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/users/me PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
