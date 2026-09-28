export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { Timestamp } from "firebase-admin/firestore";
import type { LeaveRequest } from "@/types/locationStaff";

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
    const body = (await request.json()) as { status?: LeaveRequest["status"]; approvedByUid?: string; reason?: string };

    if (!body.status || !["APPROVED", "REJECTED"].includes(body.status)) {
      return NextResponse.json({ error: "Valid status (APPROVED/REJECTED) required" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId") || session.locationId;
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }
    if (session.role !== "SUPER_ADMIN" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Unauthorized for this location" }, { status: 403 });
    }

    const db = getAdminDb();
    const leaveRef = db.collection("locations").doc(locationId).collection("leaveRequests").doc(id);
    const leaveSnap = await leaveRef.get();
    if (!leaveSnap.exists) {
      return NextResponse.json({ error: "Leave request not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = {
      status: body.status,
      approvedByUid: session.uid,
      updatedAt: Timestamp.now(),
    };
    if (body.reason) updates.reason = body.reason;

    await leaveRef.set(updates, { merge: true });

    // If approved, decrement leave balance
    if (body.status === "APPROVED") {
      const leaveData = leaveSnap.data() as LeaveRequest;
      const staffSnap = await db.collection("locations").doc(locationId).collection("staff").doc(leaveData.staffId).get();
      if (staffSnap.exists) {
        const staffData = staffSnap.data() as { leaveBalance?: number; leaveTaken?: number };
        const currentBalance = staffData.leaveBalance ?? 0;
        const currentTaken = staffData.leaveTaken ?? 0;
        if (currentBalance > 0) {
          await db.collection("locations").doc(locationId).collection("staff").doc(leaveData.staffId).set(
            { leaveBalance: currentBalance - 1, leaveTaken: currentTaken + 1, updatedAt: Timestamp.now() },
            { merge: true }
          );
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/leave/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
