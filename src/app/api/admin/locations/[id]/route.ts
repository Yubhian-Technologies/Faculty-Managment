export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin, requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Super Admin can edit any location, including (de)activating it. Administration
// can edit only its OWN location's info (name/city/state/address) from its
// Settings page - never isActive, same split as Administration editing a
// college's info but not being able to (de)activate it (api/admin/colleges PATCH).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole("SUPER_ADMIN", "ADMINISTRATION");
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    if (session.role === "ADMINISTRATION") {
      if (session.locationId !== id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if ("isActive" in body) {
        return NextResponse.json({ error: "Only Super Admin can activate/deactivate a location" }, { status: 401 });
      }
    }

    const db = getAdminDb();
    await db.collection("locations").doc(id).update({ ...body, updatedAt: new Date() });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/locations PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const db = getAdminDb();

    const collegesSnap = await db.collection("colleges").where("locationId", "==", id).limit(1).get();
    if (!collegesSnap.empty) {
      return NextResponse.json(
        { error: "Cannot delete a location that still has colleges. Remove or reassign its colleges first." },
        { status: 400 }
      );
    }

    const usersSnap = await db.collection("locations").doc(id).collection("locationUsers").limit(1).get();
    if (!usersSnap.empty) {
      return NextResponse.json(
        { error: "Cannot delete a location that still has administrators. Remove its users first." },
        { status: 400 }
      );
    }

    await db.collection("locations").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/locations DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
