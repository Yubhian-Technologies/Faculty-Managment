export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { Timestamp } from "firebase-admin/firestore";
import type { LeaveRequest } from "@/types/locationStaff";

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

    const db = getAdminDb();
    let query: FirebaseFirestore.Query = db
      .collection("locations")
      .doc(locationId)
      .collection("leaveRequests");

    const statusFilter = searchParams.get("status");
    const staffId = searchParams.get("staffId");
    const deptId = searchParams.get("departmentId");
    const dateFrom = searchParams.get("from");
    const dateTo = searchParams.get("to");

    if (statusFilter && statusFilter !== "ALL") {
      query = query.where("status", "==", statusFilter);
    }
    if (staffId) {
      query = query.where("staffId", "==", staffId);
    }
    if (deptId) {
      query = query.where("departmentId", "==", deptId);
    }
    // The date range is applied after the read: Firestore refuses a range filter on startDate
    // combined with the createdAt ordering below (the first sort must be the range field), so
    // asking for a date range used to fail outright.
    const snap = await query
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();
    const leaveRequests = (snap.docs.map((d) => ({ id: d.id, ...d.data() })) as LeaveRequest[]).filter((lr) => {
      const start = (lr as { startDate?: string }).startDate ?? "";
      if (dateFrom && start < dateFrom) return false;
      if (dateTo && start > dateTo) return false;
      return true;
    });

    // Resolve staff names for dept head view
    if (session.role === "LOCATION_DEPT_HEAD" && !staffId) {
      for (const lr of leaveRequests) {
        if (!lr.staffName) {
          const staffSnap = await db
            .collection("locations")
            .doc(locationId)
            .collection("staff")
            .doc(lr.staffId)
            .get();
          if (staffSnap.exists) {
            (lr as { staffName?: string }).staffName = (staffSnap.data() as { name?: string })?.name || lr.staffId;
          }
        }
      }
    }

    return NextResponse.json({ leaveRequests });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/leave GET]", err);
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
      staffId: string;
      departmentId: string;
      staffName: string;
      leaveType: LeaveRequest["leaveType"];
      startDate: string;
      endDate: string;
      reason: string;
      locationId?: string;
    };

    const locationId = body.locationId || session.locationId;
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }

    if (!body.staffId || !body.departmentId || !body.staffName || !body.leaveType || !body.startDate || !body.endDate || !body.reason) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Validate dates
    if (body.startDate > body.endDate) {
      return NextResponse.json({ error: "Start date must be before end date" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(body.endDate)) {
      return NextResponse.json({ error: "Dates must be YYYY-MM-DD format" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = Timestamp.now();

    const leaveRef = await db.collection("locations").doc(locationId).collection("leaveRequests").add({
      staffId: body.staffId,
      locationId,
      departmentId: body.departmentId,
      staffName: body.staffName,
      leaveType: body.leaveType,
      startDate: body.startDate,
      endDate: body.endDate,
      reason: body.reason.trim(),
      status: "PENDING",
      appliedByUid: session.uid,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: leaveRef.id, status: "PENDING" }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/leave POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
