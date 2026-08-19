export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { isManualEditWindowOpen, MANUAL_EDIT_WINDOW_CLOSED_MESSAGE } from "@/lib/attendance/attendanceWindow";
import { unitLabelForHeadRole, isCollegeStaffUnitHead, COLLEGE_STAFF_UNIT_HEAD_ROLES } from "@/lib/attendance/collegeStaffUnits";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import { recordLateCheckIn } from "@/lib/leave/lateAttendancePenalty";
import { ROLE_DASHBOARD_PATHS } from "@/types/core";
import { notify } from "@/lib/notify";
import type { AttendanceRecord } from "@/types";

// Where a person's own "My Attendance" page lives, by role - used to build
// the notification link when someone else marks their attendance for them.
// Every unit head/staff role's own dashboard follows the same
// `<dashboardPath>/attendance` convention (see ROLE_DASHBOARD_PATHS), so only
// HOD and COLLEGE_STAFF (whose "My Attendance" page isn't at their bare
// dashboard root - PANEL_MEMBER shares COLLEGE_STAFF's default) need a
// special case.
function attendancePathForRole(role: string | undefined): string {
  switch (role) {
    case "HOD": return "/hod/attendance";
    case "COLLEGE_STAFF": return "/college-staff/attendance";
    default:
      if (role && isCollegeStaffUnitHead(role)) {
        return `${ROLE_DASHBOARD_PATHS[role as keyof typeof ROLE_DASHBOARD_PATHS]}/attendance`;
      }
      return "/panel/attendance";
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseDocDate(dateStr: string): { date: Date; docSuffix: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { date: new Date(y, m - 1, d), docSuffix: dateStr };
}

// Lets someone mark or correct check-in/check-out for a person one tier
// below them who can't complete the self-attendance flow themselves - most
// commonly, they checked in on campus, then left for official work and can
// no longer pass the on-campus geofence to check out. Mirrors the
// face-registration reset cascade (see .../face-registration/reset):
//   - HOD marks a same-department Faculty member.
//   - PRINCIPAL/VICE_PRINCIPAL marks an HOD in their own college.
// A required reason is stored as the record's remarks; source flips to
// "MANUAL" with markedBy set to the marker, so this is always
// distinguishable from a real face+location-verified self check-in/out.
// Every call writes an AuditLog entry (ATTENDANCE_MARKED for a brand-new
// record, ATTENDANCE_CORRECTED for an existing one) and notifies the person
// whose attendance was marked.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", ...COLLEGE_STAFF_UNIT_HEAD_ROLES);
    const body = (await request.json()) as {
      facultyId?: string;
      date?: string;
      checkIn?: string;
      checkOut?: string;
      reason?: string;
    };

    const facultyId = body.facultyId?.trim();
    const date = body.date?.trim();
    const checkIn = body.checkIn?.trim() || undefined;
    const checkOut = body.checkOut?.trim() || undefined;
    const reason = body.reason?.trim();

    if (!facultyId || !date || !DATE_RE.test(date)) {
      return NextResponse.json({ error: "facultyId and a valid date (YYYY-MM-DD) are required" }, { status: 400 });
    }
    if (!checkIn && !checkOut) {
      return NextResponse.json({ error: "Provide a check-in time, a check-out time, or both" }, { status: 400 });
    }
    if ((checkIn && !TIME_RE.test(checkIn)) || (checkOut && !TIME_RE.test(checkOut))) {
      return NextResponse.json({ error: "Times must be in HH:MM (24h) format" }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: "A reason is required" }, { status: 400 });
    }

    const { date: docDate, docSuffix } = parseDocDate(date);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (docDate > todayStart) {
      return NextResponse.json({ error: "Cannot mark attendance for a future date" }, { status: 400 });
    }
    if (!isManualEditWindowOpen(docDate)) {
      return NextResponse.json({ error: MANUAL_EDIT_WINDOW_CLOSED_MESSAGE }, { status: 403 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const targetSnap = await collegeRef.collection("users").doc(facultyId).get();
    if (!targetSnap.exists) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }
    const target = targetSnap.data() as { name?: string; department?: string; role?: string };

    if (session.role === "HOD") {
      if (target.role !== "PANEL_MEMBER") {
        return NextResponse.json({ error: "You can only mark attendance for Faculty" }, { status: 403 });
      }
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartment(scope, target.department ?? "")) {
        return NextResponse.json(
          { error: "You can only mark attendance for faculty in your department" },
          { status: 403 }
        );
      }
    } else if (isCollegeStaffUnitHead(session.role)) {
      // Unit head - marks a COLLEGE_STAFF member belonging to their own unit
      // (same department-string link as attendance/route.ts).
      if (target.role !== "COLLEGE_STAFF" || target.department !== unitLabelForHeadRole(session.role)) {
        return NextResponse.json({ error: "You can only mark attendance for staff in your unit" }, { status: 403 });
      }
    } else {
      // PRINCIPAL / VICE_PRINCIPAL - one tier up, marks an HOD or a unit head in the same college.
      if (target.role !== "HOD" && !isCollegeStaffUnitHead(target.role ?? "")) {
        return NextResponse.json({ error: "You can only mark attendance for an HOD or unit head" }, { status: 403 });
      }
    }

    const markerSnap = await collegeRef.collection("users").doc(session.uid).get();
    const markerName = (markerSnap.data() as { name?: string } | undefined)?.name ?? "";

    const recordId = `${facultyId}_${docSuffix}`;
    const recordRef = collegeRef.collection("attendanceRecords").doc(recordId);
    const existingSnap = await recordRef.get();
    const existing = existingSnap.exists ? (existingSnap.data() as AttendanceRecord) : null;
    const now = new Date();

    // A check-out can never be at or before its check-in - compare against
    // whichever value (this request's, or the record's existing one) ends up
    // in effect once this update applies.
    const effectiveCheckIn = checkIn ?? existing?.checkIn;
    const effectiveCheckOut = checkOut ?? existing?.checkOut;
    if (effectiveCheckIn && effectiveCheckOut && effectiveCheckOut <= effectiveCheckIn) {
      return NextResponse.json({ error: "Check-out time must be after check-in time" }, { status: 400 });
    }

    const update: Record<string, unknown> = {
      status: "PRESENT",
      source: "MANUAL",
      markedBy: session.uid,
      remarks: reason,
      updatedAt: now,
    };
    if (checkIn) update.checkIn = checkIn;
    if (checkOut) update.checkOut = checkOut;

    if (!existing) {
      await recordRef.set({
        collegeId: session.collegeId,
        facultyId,
        facultyName: target.name ?? "",
        department: target.department ?? "",
        date: docDate,
        createdAt: now,
        ...update,
      });
      // Only for a brand-new record - this is someone checking in for the
      // first time that day via their HOD/unit head instead of the
      // self-service flow (they couldn't complete it themselves, e.g. off
      // campus), so the same "3 late check-ins -> 0.5 CL" rule the live
      // check-in route enforces (see lib/leave/lateAttendancePenalty.ts)
      // should apply exactly as if they'd checked in themselves. Never
      // applied when correcting an EXISTING record's time (existing is
      // truthy) - that check-in was already evaluated once, whether live or
      // via an earlier manual mark, and recordLateCheckIn has no way to
      // undo a wrongly-applied penalty, so re-evaluating on every edit would
      // risk double-counting the same day.
      if (checkIn && isLateCheckIn(checkIn)) {
        try {
          await recordLateCheckIn(db, session.collegeId, facultyId, target.name ?? "", target.department ?? "", docDate);
        } catch (err) {
          console.error("[college/attendance/manual] late-penalty recording failed", err);
        }
      }
    } else {
      await recordRef.update(update);
    }

    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: existing ? "ATTENDANCE_CORRECTED" : "ATTENDANCE_MARKED",
      performedBy: session.uid,
      performedByName: markerName,
      targetId: recordId,
      details: { facultyId, facultyName: target.name ?? "", date: docSuffix, checkIn, checkOut, reason },
      timestamp: now,
    });

    const markerLabel =
      session.role === "HOD" ? "Your HOD"
      : session.role === "PRINCIPAL" ? "Your Principal"
      : session.role === "VICE_PRINCIPAL" ? "Your Vice Principal"
      : `Your ${unitLabelForHeadRole(session.role) ?? "unit head"}`;
    await notify(
      db, session.collegeId, facultyId,
      "ATTENDANCE_MANUALLY_MARKED", "Attendance Updated",
      `${markerLabel} manually ${existing ? "corrected" : "marked"} your attendance for ${docSuffix}: ${reason}`,
      attendancePathForRole(target.role)
    );

    const updatedSnap = await recordRef.get();
    return NextResponse.json({ record: { ...(updatedSnap.data() as AttendanceRecord), id: recordId } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance/manual POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
