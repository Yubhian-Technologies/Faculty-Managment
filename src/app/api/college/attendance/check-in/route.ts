export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { checkCampusGeofence } from "@/lib/attendance/geofence";
import { SUNDAY_HOLIDAY_MESSAGE, isSunday } from "@/lib/attendance/attendanceWindow";
import { COLLEGE_STAFF_UNIT_HEAD_ROLES } from "@/lib/attendance/collegeStaffUnits";
import { getHolidayNameForDate } from "@/lib/leave/holidaysCount";
import { isOnApprovedLeaveToday } from "@/lib/leave/leaveStatusToday";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import { recordLateCheckIn } from "@/lib/leave/lateAttendancePenalty";
import { resolveCheckInPermission } from "@/lib/attendance/checkInPermission";
import { nowInIndia } from "@/lib/leave/dayCounter";
import type { College } from "@/types";

// Self-attendance check-in — geolocation and face-match verification both
// happen client-side (see src/lib/attendance/faceMatch.ts); this route only
// re-validates the geofence server-side (never trust client-reported
// distance) and records the client's reported face-match result.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_STAFF", ...COLLEGE_STAFF_UNIT_HEAD_ROLES);
    // India's own wall-clock date/time, not the server process's ambient
    // timezone (commonly UTC on a hosted deployment) - see nowInIndia's own
    // doc-comment. Everything below (which day this is, what time the
    // check-in actually happened, which permission doc to look up) has to
    // agree with what the person doing this literally just experienced.
    const { date, dateISO: docSuffix, timeHHMM: checkIn } = nowInIndia();
    if (isSunday(date)) {
      return NextResponse.json({ error: SUNDAY_HOLIDAY_MESSAGE }, { status: 403 });
    }

    const db = getAdminDb();
    const today = date;
    const holidayName = await getHolidayNameForDate(db, session.collegeId, today);
    if (holidayName) {
      return NextResponse.json({ error: `Today is a holiday — ${holidayName}. No attendance required.` }, { status: 403 });
    }
    if (await isOnApprovedLeaveToday(db, session.collegeId, session.uid, today)) {
      return NextResponse.json({ error: "You're on approved leave today — attendance cannot be marked." }, { status: 403 });
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
    // An HOD may grant this specific person an exception for today, set
    // before they check in themselves (see check-in-permission/route.ts) -
    // snapshotted onto the record so every "Late" derivation downstream
    // (isLateCheckIn) reads it the same way without a second lookup, and so
    // it stays fixed even if the permission is later changed or removed.
    const permittedCheckInTime = await resolveCheckInPermission(db, session.collegeId, session.uid, docSuffix);
    await recordRef.set({
      collegeId: session.collegeId,
      facultyId: session.uid,
      facultyName: user?.name ?? "",
      department: user?.department ?? "",
      date,
      status: "PRESENT",
      checkIn,
      source: "BIOMETRIC",
      checkInLocation: { latitude, longitude },
      checkInFaceMatchDistance: faceMatchDistance ?? null,
      checkInVerified: true,
      ...(permittedCheckInTime ? { permittedCheckInTime } : {}),
      updatedAt: now,
      ...(existingSnap.exists ? {} : { createdAt: now }),
    }, { merge: true });

    if (isLateCheckIn(checkIn, permittedCheckInTime)) {
      try {
        await recordLateCheckIn(db, session.collegeId, session.uid, user?.name ?? "", user?.department ?? "", date);
      } catch (err) {
        // Never fails the check-in itself over a penalty-bookkeeping error -
        // the person is still correctly marked PRESENT either way.
        console.error("[college/attendance/check-in] late-penalty recording failed", err);
      }
    }

    return NextResponse.json({ ok: true, checkIn });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance/check-in POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
