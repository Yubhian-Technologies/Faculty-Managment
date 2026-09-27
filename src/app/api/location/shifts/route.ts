export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { LocationShift } from "@/types/locationStaff";

export async function GET(request: Request) {
  try {
    const session = await requireRole(
      "LOCATION_DEPT_HEAD",
      "LOCATION_STAFF_ADMIN",
      "ADMINISTRATION",
      "SUPER_ADMIN"
    );

    const { searchParams } = new URL(request.url);
    let locationId = searchParams.get("locationId") || session.locationId;
    if (!locationId) {
      const firstLoc = await getAdminDb().collection("locations").limit(1).get();
      if (!firstLoc.empty) {
        locationId = firstLoc.docs[0].id;
      }
    }
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }

    const departmentId = searchParams.get("departmentId");
    const db = getAdminDb();

    let query: FirebaseFirestore.Query = db
      .collection("locations")
      .doc(locationId)
      .collection("shifts");

    if (departmentId && departmentId !== "ALL") {
      query = query.where("departmentId", "==", departmentId);
    }

    const [shiftsSnap, staffSnap] = await Promise.all([
      query.get(),
      db.collection("locations").doc(locationId).collection("staff").where("status", "==", "ACTIVE").get().catch(() => ({ docs: [] })),
    ]);

    const staffCountsByShift = new Map<string, number>();
    for (const doc of staffSnap.docs) {
      const data = doc.data() as { shiftId?: string };
      if (data.shiftId) {
        staffCountsByShift.set(data.shiftId, (staffCountsByShift.get(data.shiftId) ?? 0) + 1);
      }
    }

    const shifts = shiftsSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        assignedStaffCount: staffCountsByShift.get(d.id) ?? data.assignedStaffCount ?? 0,
      } as LocationShift;
    });

    // Sort by startTime
    shifts.sort((a, b) => a.startTime.localeCompare(b.startTime));

    return NextResponse.json({ shifts });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/shifts GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireRole(
      "LOCATION_DEPT_HEAD",
      "LOCATION_STAFF_ADMIN",
      "ADMINISTRATION",
      "SUPER_ADMIN"
    );

    const body = (await request.json()) as {
      locationId?: string;
      departmentId: string;
      name: string;
      startTime: string;
      endTime: string;
      gracePeriodMinutes?: number;
      description?: string;
      assignedStaffIds?: string[];
    };

    const locationId = body.locationId || session.locationId;
    if (!locationId || !body.departmentId || !body.name || !body.startTime || !body.endTime) {
      return NextResponse.json(
        { error: "Missing required fields: departmentId, name, startTime, endTime" },
        { status: 400 }
      );
    }

    const db = getAdminDb();

    // Fetch department details
    const deptSnap = await db
      .collection("locations")
      .doc(locationId)
      .collection("locationDepts")
      .doc(body.departmentId)
      .get();
    const departmentName = (deptSnap.data() as { name?: string })?.name || "";

    const now = new Date();
    const shiftPayload = {
      locationId,
      departmentId: body.departmentId,
      departmentName,
      name: body.name.trim(),
      startTime: body.startTime.trim(),
      endTime: body.endTime.trim(),
      gracePeriodMinutes: body.gracePeriodMinutes ?? 15,
      description: body.description?.trim() || "",
      isActive: true,
      assignedStaffCount: (body.assignedStaffIds ?? []).length,
      createdAt: now,
      updatedAt: now,
    };

    const shiftRef = await db
      .collection("locations")
      .doc(locationId)
      .collection("shifts")
      .add(shiftPayload);

    // If assignedStaffIds were passed, assign them to this new shift
    if (body.assignedStaffIds && body.assignedStaffIds.length > 0) {
      const batch = db.batch();
      for (const staffId of body.assignedStaffIds) {
        const staffRef = db.collection("locations").doc(locationId).collection("staff").doc(staffId);
        batch.set(staffRef, { shiftId: shiftRef.id, shiftName: body.name.trim(), updatedAt: now }, { merge: true });
      }
      await batch.commit();
    }

    return NextResponse.json({ id: shiftRef.id, ...shiftPayload }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/shifts POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
