export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { CHECKIN_PERMISSIONS_COL, checkInPermissionDocId } from "@/lib/attendance/checkInPermission";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import { reverseLateCheckIn } from "@/lib/leave/lateAttendancePenalty";
import { nowInIndia } from "@/lib/leave/dayCounter";
import type { AttendanceCheckInPermission } from "@/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseDocDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Lets an HOD grant a faculty member (teaching or technical - PANEL_MEMBER)
// an exception to the standard 09:05 late cutoff for one specific day, set
// BEFORE that faculty member checks in themselves - see isLateCheckIn's own
// doc-comment. One per (uid, date); posting again for the same day updates
// it in place (e.g. the HOD changing their mind about the permitted time).
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD");
    const body = (await request.json()) as {
      facultyId?: string;
      date?: string;
      permittedCheckInTime?: string;
      reason?: string;
    };

    const facultyId = body.facultyId?.trim();
    const date = body.date?.trim();
    const permittedCheckInTime = body.permittedCheckInTime?.trim();
    const reason = body.reason?.trim();

    if (!facultyId || !date || !DATE_RE.test(date)) {
      return NextResponse.json({ error: "facultyId and a valid date (YYYY-MM-DD) are required" }, { status: 400 });
    }
    if (!permittedCheckInTime || !TIME_RE.test(permittedCheckInTime)) {
      return NextResponse.json({ error: "A valid permitted check-in time (HH:MM) is required" }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: "A reason is required" }, { status: 400 });
    }
    if (!isLateCheckIn(permittedCheckInTime)) {
      return NextResponse.json(
        { error: "That time is already before the standard 09:05 cutoff - no permission is needed for it" },
        { status: 400 },
      );
    }

    const docDate = parseDocDate(date);
    // India's own calendar day, not the server host's ambient timezone - see
    // nowInIndia's doc-comment. A UTC-run server comparing against its own
    // "today" would reject granting permission for India's actual today for
    // part of every day.
    const todayStart = nowInIndia().date;
    if (docDate < todayStart) {
      return NextResponse.json({ error: "Cannot grant permission for a date that's already passed" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const targetSnap = await collegeRef.collection("users").doc(facultyId).get();
    if (!targetSnap.exists) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }
    const target = targetSnap.data() as { name?: string; department?: string; role?: string };
    if (target.role !== "PANEL_MEMBER") {
      return NextResponse.json({ error: "Check-in permission can only be granted to Faculty (teaching or technical)" }, { status: 403 });
    }

    const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
    if (!canHodEditDepartment(scope, target.department ?? "")) {
      return NextResponse.json({ error: "You can only grant this for faculty in your department" }, { status: 403 });
    }

    const grantorSnap = await collegeRef.collection("users").doc(session.uid).get();
    const grantorName = (grantorSnap.data() as { name?: string } | undefined)?.name ?? "";

    const now = new Date();
    const id = checkInPermissionDocId(facultyId, date);
    const permission: Omit<AttendanceCheckInPermission, "id" | "date" | "createdAt" | "updatedAt"> = {
      collegeId: session.collegeId,
      uid: facultyId,
      facultyName: target.name ?? "",
      department: target.department ?? "",
      permittedCheckInTime,
      reason,
      grantedBy: session.uid,
      grantedByName: grantorName,
    };
    const ref = CHECKIN_PERMISSIONS_COL(session.collegeId, db).doc(id);
    const existing = await ref.get();
    await ref.set({
      ...permission,
      date: docDate,
      updatedAt: now,
      ...(existing.exists ? {} : { createdAt: now }),
    }, { merge: true });

    // The live check-in route only ever resolves a permission AT THE MOMENT
    // of check-in - so if this person already has that day's attendance
    // recorded (the common real flow: HOD sees someone arrived late, THEN
    // excuses it), the existing record is stale until reconciled here. A
    // permission is a full exemption for the day (see isLateCheckIn) and
    // this route always sets a non-empty permittedCheckInTime, so granting
    // one can only ever REMOVE lateness here, never add it - nothing to
    // handle in the other direction.
    const recordRef = collegeRef.collection("attendanceRecords").doc(`${facultyId}_${date}`);
    const recordSnap = await recordRef.get();
    const record = recordSnap.data() as { checkIn?: string; permittedCheckInTime?: string } | undefined;
    if (record?.checkIn) {
      const wasLate = isLateCheckIn(record.checkIn, record.permittedCheckInTime);
      if (record.permittedCheckInTime !== permittedCheckInTime) {
        await recordRef.update({ permittedCheckInTime, updatedAt: now });
      }
      try {
        if (wasLate) {
          await reverseLateCheckIn(db, session.collegeId, facultyId, docDate);
        }
      } catch (err) {
        // Never fails the grant itself over penalty-bookkeeping reconciliation -
        // the permission (and the record's own permittedCheckInTime, which is
        // what the "Late" badge actually reads) are already saved either way.
        console.error("[college/attendance/check-in-permission] late-penalty reconciliation failed", err);
      }
    }

    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "LATE_CHECKIN_PERMISSION_GRANTED",
      performedBy: session.uid,
      performedByName: grantorName,
      targetId: id,
      details: { facultyId, facultyName: target.name ?? "", date, permittedCheckInTime, reason },
      timestamp: now,
    });

    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance/check-in-permission POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// One department's permissions for one date - lets the Faculty Attendance
// report show which rows already have an active grant (and what time), so
// the HOD isn't guessing whether they already granted one before opening
// the dialog again.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD");
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    if (!date || !DATE_RE.test(date)) {
      return NextResponse.json({ error: "A valid date (YYYY-MM-DD) is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
    const deptNames = [...scope.ownDepartmentNames, ...scope.childDepartmentNames].slice(0, 30);
    if (deptNames.length === 0) {
      return NextResponse.json({ permissions: [] });
    }

    const docDate = parseDocDate(date);
    const snap = await CHECKIN_PERMISSIONS_COL(session.collegeId, db)
      .where("department", "in", deptNames)
      .get();

    const permissions = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as AttendanceCheckInPermission)
      .filter((p) => {
        const d = (p.date as unknown as { toDate?: () => Date })?.toDate?.();
        return d && d.getTime() === docDate.getTime();
      });

    return NextResponse.json({ permissions });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance/check-in-permission GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
