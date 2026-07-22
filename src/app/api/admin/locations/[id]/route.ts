export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
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
