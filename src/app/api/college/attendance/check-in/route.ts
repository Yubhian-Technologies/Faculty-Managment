export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { checkCampusGeofence } from "@/lib/attendance/geofence";
import { SUNDAY_HOLIDAY_MESSAGE, isSunday } from "@/lib/attendance/attendanceWindow";
import { COLLEGE_STAFF_UNIT_HEAD_ROLES } from "@/lib/attendance/collegeStaffUnits";
import { istMidnightUTC, istDateKey, istTimeHHMM } from "@/lib/attendance/istTime";
import type { College } from "@/types";

function todayDocDate(): { date: Date; docSuffix: string } {
  const now = new Date();
  return { date: istMidnightUTC(now), docSuffix: istDateKey(now) };
}

function currentTimeHHMM(): string {
  return istTimeHHMM(new Date());
}

// Self-attendance check-in — geolocation and face-match verification both
// happen client-side (see src/lib/attendance/faceMatch.ts); this route only
// re-validates the geofence server-side (never trust client-reported
// distance) and records the client's reported face-match result.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_STAFF", ...COLLEGE_STAFF_UNIT_HEAD_ROLES);
    if (isSunday()) {
      return NextResponse.json({ error: SUNDAY_HOLIDAY_MESSAGE }, { status: 403 });
    }
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

    const userSnap = await collegeRef.collection("users").doc(session.uid).get();
    const user = userSnap.data() as { name?: string; department?: string } | undefined;

    const { date, docSuffix } = todayDocDate();
    const recordId = `${session.uid}_${docSuffix}`;
    const recordRef = collegeRef.collection("attendanceRecords").doc(recordId);
    const existingSnap = await recordRef.get();
    const existing = existingSnap.data() as { checkIn?: string; status?: string } | undefined;

    if (existing?.checkIn) {
      return NextResponse.json({ error: "You have already checked in today" }, { status: 409 });
    }
    if (existing?.status && !["PRESENT"].includes(existing.status)) {
      return NextResponse.json({ error: `Today is already marked as ${existing.status} — contact your HOD to update this` }, { status: 409 });
    }

    const now = new Date();
    await recordRef.set({
      collegeId: session.collegeId,
      facultyId: session.uid,
      facultyName: user?.name ?? "",
      department: user?.department ?? "",
      date,
      status: "PRESENT",
      checkIn: currentTimeHHMM(),
      source: "BIOMETRIC",
      checkInLocation: { latitude, longitude },
      checkInFaceMatchDistance: faceMatchDistance ?? null,
      checkInVerified: true,
      updatedAt: now,
      ...(existingSnap.exists ? {} : { createdAt: now }),
    }, { merge: true });

    return NextResponse.json({ ok: true, checkIn: currentTimeHHMM() });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance/check-in POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
