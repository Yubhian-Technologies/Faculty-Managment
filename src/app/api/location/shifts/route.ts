export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { narrowToActiveLocationDept } from "@/lib/location/activeLocationDept";
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
    const locationId = searchParams.get("locationId") || session.locationId;
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }
    if (session.role !== "SUPER_ADMIN" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Unauthorized for this location" }, { status: 403 });
    }

    let departmentId = searchParams.get("departmentId");
    const db = getAdminDb();

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

      if (!departmentId && depts.length > 0) {
        departmentId = await narrowToActiveLocationDept(session.uid, depts);
      }
      if (departmentId && departmentId !== "ALL" && depts.length > 0 && !depts.includes(departmentId)) {
        return NextResponse.json({ error: "Unauthorized for this department" }, { status: 403 });
      }
    }

    const [shiftsSnap, staffSnap] = await Promise.all([
      db.collection("locations").doc(locationId).collection("shifts").get(),
      db.collection("locations").doc(locationId).collection("staff").where("status", "==", "ACTIVE").get().catch(() => ({ docs: [] })),
    ]);

    const staffCountsByShift = new Map<string, number>();
    const deptStaffCountsByShift = new Map<string, number>();

    for (const doc of staffSnap.docs) {
      const data = doc.data() as { shiftId?: string; departmentId?: string };
      if (data.shiftId) {
        staffCountsByShift.set(data.shiftId, (staffCountsByShift.get(data.shiftId) ?? 0) + 1);
        if (departmentId && data.departmentId === departmentId) {
          deptStaffCountsByShift.set(data.shiftId, (deptStaffCountsByShift.get(data.shiftId) ?? 0) + 1);
        }
      }
    }

    const allShifts = shiftsSnap.docs.map((d) => {
      const data = d.data();
      const sDeptIds: string[] = Array.isArray(data.departmentIds)
        ? data.departmentIds
        : data.departmentId
        ? [data.departmentId]
        : [];

      return {
        id: d.id,
        ...data,
        departmentIds: sDeptIds,
        assignedStaffCount: staffCountsByShift.get(d.id) ?? data.assignedStaffCount ?? 0,
        deptAssignedStaffCount: departmentId && departmentId !== "ALL"
          ? (deptStaffCountsByShift.get(d.id) ?? 0)
          : (staffCountsByShift.get(d.id) ?? data.assignedStaffCount ?? 0),
      } as LocationShift;
    });

    // If filtered by departmentId and not "ALL", include shifts that belong to this dept OR are campus-wide / shared with this dept
    const shifts = departmentId && departmentId !== "ALL"
      ? allShifts.filter((s) => {
          if (s.isCampusWide || s.departmentId === "ALL") return true;
          if (s.departmentId === departmentId) return true;
          if (Array.isArray(s.departmentIds) && (s.departmentIds.includes("ALL") || s.departmentIds.includes(departmentId))) {
            return true;
          }
          return false;
        })
      : allShifts;

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
      "LOCATION_STAFF_ADMIN",
      "ADMINISTRATION",
      "SUPER_ADMIN"
    );

    const body = (await request.json()) as {
      locationId?: string;
      departmentId?: string;
      departmentIds?: string[];
      isCampusWide?: boolean;
      name: string;
      startTime: string;
      endTime: string;
      gracePeriodMinutes?: number;
      description?: string;
      assignedStaffIds?: string[];
    };

    const locationId = body.locationId || session.locationId;
    const isCampusWide = !!body.isCampusWide || body.departmentId === "ALL" || (Array.isArray(body.departmentIds) && body.departmentIds.includes("ALL"));
    const rawDeptIds = Array.isArray(body.departmentIds) && body.departmentIds.length > 0
      ? body.departmentIds.filter((id) => id && id !== "__none__")
      : body.departmentId && body.departmentId !== "__none__"
      ? [body.departmentId]
      : [];

    if (!locationId || (!isCampusWide && rawDeptIds.length === 0) || !body.name || !body.startTime || !body.endTime) {
      return NextResponse.json(
        { error: "Missing required fields: specify at least one department or make campus-wide, name, startTime, endTime" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    let departmentNames: string[] = [];
    let primaryDeptId = "ALL";
    let primaryDeptName = "All Campus Departments";

    if (isCampusWide) {
      primaryDeptId = "ALL";
      primaryDeptName = "All Campus Departments";
      departmentNames = ["All Campus Departments"];
    } else {
      primaryDeptId = rawDeptIds[0];
      // Fetch department details for each chosen departmentId
      const deptSnaps = await Promise.all(
        rawDeptIds.map((dId) =>
          db.collection("locations").doc(locationId).collection("locationDepts").doc(dId).get()
        )
      );
      departmentNames = deptSnaps.map((snap) => (snap.data() as { name?: string })?.name || snap.id);
      primaryDeptName = departmentNames.length === 1 ? departmentNames[0] : `${departmentNames[0]} (+${departmentNames.length - 1} more)`;
    }

    const now = new Date();
    const shiftPayload = {
      locationId,
      departmentId: primaryDeptId,
      departmentName: primaryDeptName,
      departmentIds: isCampusWide ? ["ALL"] : rawDeptIds,
      departmentNames,
      isCampusWide,
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
