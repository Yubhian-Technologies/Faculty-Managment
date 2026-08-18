export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { checkCampusGeofence } from "@/lib/attendance/geofence";
import { COLLEGE_STAFF_UNIT_HEAD_ROLES } from "@/lib/attendance/collegeStaffUnits";
import type { College } from "@/types";

function todayDocSuffix(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function currentTimeHHMM(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_STAFF", ...COLLEGE_STAFF_UNIT_HEAD_ROLES);
    const body = (await request.json()) as {
      latitude?: number;
      longitude?: number;
      faceMatchDistance?: number;
      faceVerified?: boolean;
    };

    const { latitude, longitude, faceMatchDistance, faceVerified } = body;
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return NextResponse.json({ error: "Location is required" }, { status: 400 });
    }
    if (!faceVerified) {
      return NextResponse.json({ error: "Face not verified — please try again" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const collegeSnap = await collegeRef.get();
    const college = collegeSnap.data() as College | undefined;
    if (!college?.campusLocation) {
      return NextResponse.json({ error: "Campus location is not configured for your college — contact your Super Admin" }, { status: 400 });
    }

    const geofence = checkCampusGeofence(latitude, longitude, college.campusLocation);
    if (!geofence.withinBounds) {
      return NextResponse.json({ error: geofence.message }, { status: 403 });
    }

    const recordId = `${session.uid}_${todayDocSuffix()}`;
    const recordRef = collegeRef.collection("attendanceRecords").doc(recordId);
    const existingSnap = await recordRef.get();
    if (!existingSnap.exists || !(existingSnap.data() as { checkIn?: string }).checkIn) {
      return NextResponse.json({ error: "You must check in before you can check out" }, { status: 409 });
    }
    if ((existingSnap.data() as { checkOut?: string }).checkOut) {
      return NextResponse.json({ error: "You have already checked out today" }, { status: 409 });
    }

    await recordRef.set({
      checkOut: currentTimeHHMM(),
      checkOutLocation: { latitude, longitude },
      checkOutFaceMatchDistance: faceMatchDistance ?? null,
      checkOutVerified: true,
      updatedAt: new Date(),
    }, { merge: true });

    return NextResponse.json({ ok: true, checkOut: currentTimeHHMM() });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance/check-out POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
