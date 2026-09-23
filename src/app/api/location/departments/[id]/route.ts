export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

// Rename and/or activate/deactivate a location department. Same
// authorization shape as this collection's own POST: SUPER_ADMIN can act on
// any location, ADMINISTRATION (Location Admin) only on its own.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await verifySession();
    if (!session || !["SUPER_ADMIN", "ADMINISTRATION"].includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = (await request.json()) as { locationId?: string; name?: string; isActive?: boolean };
    const { locationId, name, isActive } = body;

    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }
    if (session.role === "ADMINISTRATION" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (name === undefined && isActive === undefined) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    if (name !== undefined && !name.trim()) {
      return NextResponse.json({ error: "Name can't be empty" }, { status: 400 });
    }

    const db = getAdminDb();
    const deptRef = db.collection("locations").doc(locationId).collection("locationDepts").doc(id);
    const deptSnap = await deptRef.get();
    if (!deptSnap.exists) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name.trim();
    if (isActive !== undefined) updates.isActive = isActive;
    await deptRef.set(updates, { merge: true });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[location/departments/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Permanently removes a location department. Refuses while a Dept Head is
// still assigned to it (deptHeadUid set by /api/location/users' own POST/
// PATCH when someone is appointed LOCATION_DEPT_HEAD here) - deleting out
// from under them would leave that person's account pointing at a
// locationDeptId that no longer resolves to anything.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await verifySession();
    if (!session || !["SUPER_ADMIN", "ADMINISTRATION"].includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") ?? "";
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }
    if (session.role === "ADMINISTRATION" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getAdminDb();
    const deptRef = db.collection("locations").doc(locationId).collection("locationDepts").doc(id);
    const deptSnap = await deptRef.get();
    if (!deptSnap.exists) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }
    const dept = deptSnap.data() as { name?: string; deptHeadUid?: string; deptHeadName?: string };
    if (dept.deptHeadUid) {
      return NextResponse.json(
        { error: `"${dept.name}" still has ${dept.deptHeadName ?? "a"} Dept Head assigned - remove or reassign them from Location Staff first.` },
        { status: 409 }
      );
    }

    await deptRef.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[location/departments/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
