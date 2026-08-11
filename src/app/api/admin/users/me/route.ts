export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Self-service "My Profile" for GLOBAL-scoped roles (SUPER_ADMIN, MANAGEMENT,
// FINANCE, PURCHASE_DEPT) - these have no college/location of their own, so
// their identity lives only at systemUsers/{uid}, unlike college-scoped roles
// which self-serve via /api/college/users/me.
const GLOBAL_ROLES = ["SUPER_ADMIN", "MANAGEMENT", "FINANCE", "PURCHASE_DEPT"];

export async function GET() {
  try {
    const session = await requireRole(...GLOBAL_ROLES);
    const db = getAdminDb();
    const snap = await db.collection("systemUsers").doc(session.uid).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ user: { uid: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/users/me GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireRole(...GLOBAL_ROLES);

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
    const userRef = db.collection("systemUsers").doc(session.uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined && body.name.trim()) updates.name = body.name.trim();
    if (body.email !== undefined && body.email.trim()) updates.email = body.email.trim();
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.profilePhotoUrl !== undefined) updates.profilePhotoUrl = body.profilePhotoUrl;

    await userRef.update(updates);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/users/me PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
