export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { LocationShift } from "@/types/locationStaff";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole(
      "LOCATION_DEPT_HEAD",
      "LOCATION_STAFF_ADMIN",
      "ADMINISTRATION",
      "SUPER_ADMIN"
    );

    const { id } = await params;
    const body = (await request.json()) as Partial<LocationShift> & {
      locationId?: string;
      assignedStaffIds?: string[];
      unassignedStaffIds?: string[];
    };

    const locationId = body.locationId || session.locationId;
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }

    const db = getAdminDb();
    const shiftRef = db.collection("locations").doc(locationId).collection("shifts").doc(id);
    const shiftSnap = await shiftRef.get();
    if (!shiftSnap.exists) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.startTime !== undefined) updates.startTime = body.startTime.trim();
    if (body.endTime !== undefined) updates.endTime = body.endTime.trim();
    if (body.gracePeriodMinutes !== undefined) updates.gracePeriodMinutes = body.gracePeriodMinutes;
    if (body.description !== undefined) updates.description = body.description.trim();
    if (body.isActive !== undefined) updates.isActive = body.isActive;

    await shiftRef.set(updates, { merge: true });

    // Handle assigning / unassigning staff
    const currentShift = shiftSnap.data() as LocationShift;
    const shiftName = (updates.name as string) || currentShift.name;

    if (body.assignedStaffIds && body.assignedStaffIds.length > 0) {
      const batch = db.batch();
      for (const staffId of body.assignedStaffIds) {
        const staffRef = db.collection("locations").doc(locationId).collection("staff").doc(staffId);
        batch.set(staffRef, { shiftId: id, shiftName, updatedAt: now }, { merge: true });
      }
      await batch.commit();
    }

    if (body.unassignedStaffIds && body.unassignedStaffIds.length > 0) {
      const batch = db.batch();
      for (const staffId of body.unassignedStaffIds) {
        const staffRef = db.collection("locations").doc(locationId).collection("staff").doc(staffId);
        batch.set(staffRef, { shiftId: "", shiftName: "", updatedAt: now }, { merge: true });
      }
      await batch.commit();
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/shifts/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole(
      "LOCATION_DEPT_HEAD",
      "LOCATION_STAFF_ADMIN",
      "ADMINISTRATION",
      "SUPER_ADMIN"
    );

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") || session.locationId;
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }

    const db = getAdminDb();
    const shiftRef = db.collection("locations").doc(locationId).collection("shifts").doc(id);
    const shiftSnap = await shiftRef.get();
    if (!shiftSnap.exists) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }

    // Clear shift assignments from any assigned staff
    const staffQuery = await db
      .collection("locations")
      .doc(locationId)
      .collection("staff")
      .where("shiftId", "==", id)
      .get();

    if (!staffQuery.empty) {
      const batch = db.batch();
      for (const doc of staffQuery.docs) {
        batch.set(doc.ref, { shiftId: "", shiftName: "", updatedAt: new Date() }, { merge: true });
      }
      await batch.commit();
    }

    await shiftRef.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/shifts/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
