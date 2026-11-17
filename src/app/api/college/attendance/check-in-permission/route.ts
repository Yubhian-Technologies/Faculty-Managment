export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { CHECKIN_PERMISSIONS_COL, checkInPermissionDocId } from "@/lib/attendance/checkInPermission";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import { collegeLateAfter } from "@/lib/attendance/attendanceTimingsServer";
import { reverseLateCheckIn } from "@/lib/leave/lateAttendancePenalty";
import { nowInIndia } from "@/lib/leave/dayCounter";
import { isHodOrUnitHead } from "@/lib/attendance/collegeStaffUnits";
import { MAX_PERMISSION_DAYS, permissionDates } from "@/lib/attendance/permissionRange";
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
// `toDate` (optional) grants the same time for every day from `date` to `toDate`
// (Sundays left out, at most MAX_PERMISSION_DAYS) - one permission per day, so
// everything that reads a day's permission is unchanged.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const body = (await readJsonBody(request)) as {
      facultyId?: string;
      date?: string;
      toDate?: string;
      permittedCheckInTime?: string;
      reason?: string;
    };

    const facultyId = body.facultyId?.trim();
    const date = body.date?.trim();
    const permittedCheckInTime = body.permittedCheckInTime?.trim();
    const reason = body.reason?.trim();
    const toDate = body.toDate?.trim() || date;

    if (!facultyId || !date || !DATE_RE.test(date)) {
      return NextResponse.json({ error: "facultyId and a valid date (YYYY-MM-DD) are required" }, { status: 400 });
    }
    const dates = permissionDates(date, toDate ?? date);
    if (!dates) {
      return NextResponse.json({ error: `Select a To date on or after the From date, at most ${MAX_PERMISSION_DAYS} days later.` }, { status: 400 });
    }
    if (dates.length === 0) {
      return NextResponse.json({ error: "The dates picked are all Sundays." }, { status: 400 });
    }
    if (!permittedCheckInTime || !TIME_RE.test(permittedCheckInTime)) {
      return NextResponse.json({ error: "A valid permitted check-in time (HH:MM) is required" }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: "Enter a reason." }, { status: 400 });
    }
    const collegeCutoff = await collegeLateAfter(getAdminDb(), session.collegeId);
    if (!isLateCheckIn(permittedCheckInTime, null, collegeCutoff)) {
      return NextResponse.json(
        { error: `That time is not after the college's late cut-off (${collegeCutoff}), so no permission is needed for it.` },
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
      return NextResponse.json({ error: "Person not found. The record may have been deleted." }, { status: 404 });
    }
    const target = targetSnap.data() as { name?: string; department?: string; role?: string };
    if (session.role === "HOD") {
      if (target.role !== "PANEL_MEMBER") {
        return NextResponse.json({ error: "Check-in permission can only be granted to Faculty (teaching or technical)" }, { status: 403 });
      }
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartment(scope, target.department ?? "")) {
        return NextResponse.json({ error: "You can only grant this for faculty in your department" }, { status: 403 });
      }
    } else {
      // PRINCIPAL / VICE_PRINCIPAL — one tier up, grants to HOD or unit heads
      if (!isHodOrUnitHead(target as { role?: string; department?: string })) {
        return NextResponse.json({ error: "You can only grant this for an HOD or unit head" }, { status: 403 });
      }
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
    // One permission per day of the range; an existing one for a day is updated in place.
    const refs = dates.map((d) => CHECKIN_PERMISSIONS_COL(session.collegeId, db).doc(checkInPermissionDocId(facultyId, d)));
    const existing = await db.getAll(...refs);
    const batch = db.batch();
    dates.forEach((d, i) => {
      batch.set(refs[i], {
        ...permission,
        date: parseDocDate(d),
        ...(dates.length > 1 ? { rangeFrom: date, rangeTo: toDate } : {}),
        updatedAt: now,
        ...(existing[i].exists ? {} : { createdAt: now }),
      }, { merge: true });
    });
    await batch.commit();

    // The live check-in route only ever resolves a permission AT THE MOMENT
    // of check-in - so if this person already has that day's attendance
    // recorded (the common real flow: HOD sees someone arrived late, THEN
    // excuses it), the existing record is stale until reconciled here. Only the
    // first day of a grant can already have one (no past dates are allowed).
    // A permission is a full exemption for the day (see isLateCheckIn) and
    // this route always sets a non-empty permittedCheckInTime, so granting
    // one can only ever REMOVE lateness here, never add it.
    const recordRef = collegeRef.collection("attendanceRecords").doc(`${facultyId}_${date}`);
    const recordSnap = await recordRef.get();
    const record = recordSnap.data() as { checkIn?: string; permittedCheckInTime?: string; lateAfter?: string } | undefined;
    if (record?.checkIn) {
      const wasLate = isLateCheckIn(record.checkIn, record.permittedCheckInTime, record.lateAfter);
      if (record.permittedCheckInTime !== permittedCheckInTime) {
        await recordRef.update({ permittedCheckInTime, updatedAt: now });
      }
      try {
        if (wasLate) {
          await reverseLateCheckIn(db, session.collegeId, facultyId, docDate);
        }
      } catch (err) {
        const badBody = badBodyResponse(err);
        if (badBody) return badBody;
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
      details: { facultyId, facultyName: target.name ?? "", date, ...(toDate !== date ? { toDate, days: dates.length } : {}), permittedCheckInTime, reason },
      timestamp: now,
    });

    return NextResponse.json({ id, days: dates.length });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/attendance/check-in-permission POST]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
