export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { checkCampusGeofence } from "@/lib/attendance/geofence";
import { SUNDAY_HOLIDAY_MESSAGE, isSunday } from "@/lib/attendance/attendanceWindow";
import { COLLEGE_STAFF_UNIT_HEAD_ROLES } from "@/lib/attendance/collegeStaffUnits";
import { isWorkingDayForRole } from "@/lib/attendance/workingDays";
import { getHolidayNameForDate } from "@/lib/leave/holidaysCount";
import { isOnApprovedLeaveToday } from "@/lib/leave/leaveStatusToday";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import { recordLateCheckIn } from "@/lib/leave/lateAttendancePenalty";
import { resolveCheckInPermission } from "@/lib/attendance/checkInPermission";
import { nowInIndia } from "@/lib/leave/dayCounter";
import type { College, UserRole } from "@/types";

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
    const db = getAdminDb();
    const today = date;
    // A Working Day override (see college-office/holidays/page.tsx) naming
    // this caller's own role flips today from a Sunday off to a working day
    // for them specifically - everyone else still gets the day off.
    if (isSunday(date) && !(await isWorkingDayForRole(db, session.collegeId, today, session.role as UserRole))) {
      return NextResponse.json({ error: SUNDAY_HOLIDAY_MESSAGE }, { status: 403 });
    }

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
    const now = new Date();
    const permittedCheckInTime = await resolveCheckInPermission(db, session.collegeId, session.uid, docSuffix);

    // Transactional check-then-set so a double-tapped/retried request cannot
    // double-write and double-fire recordLateCheckIn for one physical check-in.
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(recordRef);
        const existing = snap.data() as { checkIn?: string; status?: string } | undefined;
        if (existing?.checkIn) throw new Error("ALREADY_CHECKED_IN");
        if (existing?.status && !["PRESENT"].includes(existing.status)) throw new Error(`ALREADY_MARKED_${existing.status}`);
        tx.set(recordRef, {
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
          ...(snap.exists ? {} : { createdAt: now }),
        }, { merge: true });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "ALREADY_CHECKED_IN") return NextResponse.json({ error: "You have already checked in today" }, { status: 409 });
      if (msg.startsWith("ALREADY_MARKED_")) {
        const st = msg.replace("ALREADY_MARKED_", "");
        return NextResponse.json({ error: `Today is already marked as ${st} — contact your HOD to update this` }, { status: 409 });
      }
      throw e;
    }

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
