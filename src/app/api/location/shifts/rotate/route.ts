export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { LocationShift } from "@/types/locationStaff";

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
      staffId?: string;
      staffIds?: string[];
      targetShiftId: string; // shift ID, or "" / "__unassigned__" to remove from shift
    };

    const locationId = body.locationId || session.locationId;
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }

    const idsToRotate = body.staffIds && body.staffIds.length > 0
      ? body.staffIds
      : body.staffId
      ? [body.staffId]
      : [];

    if (idsToRotate.length === 0) {
      return NextResponse.json({ error: "staffId or staffIds required" }, { status: 400 });
    }

    const db = getAdminDb();
    const isUnassigning = !body.targetShiftId || body.targetShiftId === "__unassigned__";

    let targetShiftName = "";
    if (!isUnassigning) {
      const shiftSnap = await db
        .collection("locations")
        .doc(locationId)
        .collection("shifts")
        .doc(body.targetShiftId)
        .get();

      if (!shiftSnap.exists) {
        return NextResponse.json({ error: "Target shift not found" }, { status: 404 });
      }
      targetShiftName = (shiftSnap.data() as LocationShift)?.name || "";

      if (session.role === "LOCATION_DEPT_HEAD") {
        const userDoc = await db.collection("locations").doc(locationId).collection("locationUsers").doc(session.uid).get();
        const udata = (userDoc.data() as { locationDeptId?: string; locationDeptIds?: string[] } | undefined) ?? {};
        const depts = Array.from(
          new Set([...(udata.locationDeptIds ?? []), ...(udata.locationDeptId ? [udata.locationDeptId] : [])])
        );
        const [h1, h2] = await Promise.all([
          db.collection("locations").doc(locationId).collection("locationDepts").where("headUid", "==", session.uid).get(),
          db.collection("locations").doc(locationId).collection("locationDepts").where("deptHeadUid", "==", session.uid).get(),
        ]);
        for (const d of [...h1.docs, ...h2.docs]) {
          if (!depts.includes(d.id)) depts.push(d.id);
        }

        const sDept = (shiftSnap.data() as LocationShift)?.departmentId;
        if (sDept && depts.length > 0 && !depts.includes(sDept)) {
          return NextResponse.json({ error: "Unauthorized for target shift's department" }, { status: 403 });
        }
      }
    }

    const now = new Date();
    const batch = db.batch();

    for (const sId of idsToRotate) {
      const staffRef = db
        .collection("locations")
        .doc(locationId)
        .collection("staff")
        .doc(sId);

      batch.set(
        staffRef,
        {
          shiftId: isUnassigning ? "" : body.targetShiftId,
          shiftName: isUnassigning ? "" : targetShiftName,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    await batch.commit();

    return NextResponse.json({
      ok: true,
      count: idsToRotate.length,
      targetShiftId: isUnassigning ? "" : body.targetShiftId,
      targetShiftName: isUnassigning ? "Unassigned" : targetShiftName,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/shifts/rotate POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
