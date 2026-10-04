export const dynamic = "force-dynamic";

import { scopedLocationId } from "@/lib/location/scope";
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
      linkDepartmentId?: string;
      unlinkDepartmentId?: string;
    };

    const locationId = scopedLocationId(session, body.locationId);
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

    if (body.isCampusWide !== undefined || body.departmentIds !== undefined || body.departmentId !== undefined) {
      const isCampusWide = body.isCampusWide !== undefined
        ? body.isCampusWide
        : body.departmentId === "ALL" || (Array.isArray(body.departmentIds) && body.departmentIds.includes("ALL"));

      if (isCampusWide) {
        updates.isCampusWide = true;
        updates.departmentId = "ALL";
        updates.departmentName = "All Campus Departments";
        updates.departmentIds = ["ALL"];
        updates.departmentNames = ["All Campus Departments"];
      } else {
        const rawDeptIds = Array.isArray(body.departmentIds) && body.departmentIds.length > 0
          ? body.departmentIds.filter((dId) => dId && dId !== "__none__")
          : body.departmentId && body.departmentId !== "__none__"
          ? [body.departmentId]
          : [];

        if (rawDeptIds.length > 0) {
          const deptSnaps = await Promise.all(
            rawDeptIds.map((dId) =>
              db.collection("locations").doc(locationId).collection("locationDepts").doc(dId).get()
            )
          );
          const departmentNames = deptSnaps.map((snap) => (snap.data() as { name?: string })?.name || snap.id);
          updates.isCampusWide = false;
          updates.departmentIds = rawDeptIds;
          updates.departmentNames = departmentNames;
          updates.departmentId = rawDeptIds[0];
          updates.departmentName = departmentNames.length === 1 ? departmentNames[0] : `${departmentNames[0]} (+${departmentNames.length - 1} more)`;
        }
      }
    }

    const currentShift = shiftSnap.data() as LocationShift;

    // Link a department to reuse this shift
    if (body.linkDepartmentId) {
      const dSnap = await db.collection("locations").doc(locationId).collection("locationDepts").doc(body.linkDepartmentId).get();
      if (dSnap.exists) {
        const dName = (dSnap.data() as { name?: string })?.name || body.linkDepartmentId;
        const existingIds: string[] = Array.isArray(currentShift.departmentIds)
          ? currentShift.departmentIds.filter((dId) => dId !== "ALL")
          : currentShift.departmentId && currentShift.departmentId !== "ALL"
          ? [currentShift.departmentId]
          : [];
        const existingNames: string[] = Array.isArray(currentShift.departmentNames)
          ? currentShift.departmentNames.filter((n) => n !== "All Campus Departments")
          : currentShift.departmentName && currentShift.departmentName !== "All Campus Departments"
          ? [currentShift.departmentName]
          : [];

        if (!existingIds.includes(body.linkDepartmentId)) {
          existingIds.push(body.linkDepartmentId);
          existingNames.push(dName);
          updates.departmentIds = existingIds;
          updates.departmentNames = existingNames;
          updates.departmentId = existingIds[0];
          updates.departmentName = existingNames.length === 1 ? existingNames[0] : `${existingNames[0]} (+${existingNames.length - 1} more)`;
          updates.isCampusWide = false;
        }
      }
    }

    // Unlink a department from this shift
    if (body.unlinkDepartmentId) {
      const existingIds: string[] = (Array.isArray(currentShift.departmentIds) ? currentShift.departmentIds : [currentShift.departmentId]).filter(
        (dId) => dId && dId !== "ALL" && dId !== body.unlinkDepartmentId
      );
      const existingNames: string[] = (Array.isArray(currentShift.departmentNames) ? currentShift.departmentNames : [currentShift.departmentName || ""]).filter(
        (_n, idx) => {
          const correspondingId = (Array.isArray(currentShift.departmentIds) ? currentShift.departmentIds : [currentShift.departmentId])[idx];
          return correspondingId !== body.unlinkDepartmentId;
        }
      );

      updates.departmentIds = existingIds;
      updates.departmentNames = existingNames;
      updates.departmentId = existingIds[0] || "";
      updates.departmentName = existingNames.length > 0 ? (existingNames.length === 1 ? existingNames[0] : `${existingNames[0]} (+${existingNames.length - 1} more)`) : "";
    }

    await shiftRef.set(updates, { merge: true });

    // Handle assigning / unassigning staff
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
      "LOCATION_STAFF_ADMIN",
      "ADMINISTRATION",
      "SUPER_ADMIN"
    );

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const locationId = scopedLocationId(session, searchParams.get("locationId"));
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
