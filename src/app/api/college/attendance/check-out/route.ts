export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { checkCampusGeofence } from "@/lib/attendance/geofence";
import { COLLEGE_STAFF_UNIT_HEAD_ROLES } from "@/lib/attendance/collegeStaffUnits";
import { istDateKey, istTimeHHMM } from "@/lib/attendance/istTime";
import { verifyAttendanceProof, type AttendanceProofBody } from "@/lib/attendance/attendanceProof";
import { earlyCheckOutState } from "@/lib/attendance/earlyCheckOutServer";
import { CLASSES_LEFT_MESSAGE, EARLY_REASON_MESSAGE } from "@/lib/attendance/earlyCheckOut";
import type { College } from "@/types";

const ROLES = ["PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_STAFF", ...COLLEGE_STAFF_UNIT_HEAD_ROLES] as const;

// GET: where today's check-out stands - before the college's End Time (Attendance Timings) it is early (a reason is
// needed), and a faculty member's classes still left must each be adjusted or covered by a permission first
// (lib/attendance/earlyCheckOut.ts). The page asks this before opening the face / phone check, and POST re-checks.
export async function GET() {
  try {
    const session = await requireCollegeMember(...ROLES);
    const state = await earlyCheckOutState(getAdminDb(), session.collegeId, session.uid, session.role);
    return NextResponse.json(state);
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/attendance/check-out GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}

function todayDocSuffix(): string {
  return istDateKey(new Date());
}

function currentTimeHHMM(): string {
  return istTimeHHMM(new Date());
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const body = (await readJsonBody(request)) as AttendanceProofBody & {
      latitude?: number;
      longitude?: number;
      earlyReason?: string;
    };

    const { latitude, longitude } = body;
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return NextResponse.json({ error: "Location is required" }, { status: 400 });
    }

    const db = getAdminDb();
    // Early check-out: checked before the face / phone proof, so a refusal never uses up a one-time passkey challenge.
    const early = await earlyCheckOutState(db, session.collegeId, session.uid, session.role);
    const earlyReason = typeof body.earlyReason === "string" ? body.earlyReason.trim().slice(0, 500) : "";
    if (early.early) {
      if (early.uncovered.length > 0) {
        return NextResponse.json({ error: CLASSES_LEFT_MESSAGE, code: "CLASSES_LEFT", state: early }, { status: 409 });
      }
      if (!earlyReason) {
        return NextResponse.json({ error: EARLY_REASON_MESSAGE, code: "EARLY_REASON_NEEDED", state: early }, { status: 409 });
      }
    }
    // The server compares the posted face descriptor with the registered one
    // itself (see lib/attendance/attendanceProof.ts); the client's own
    // "faceVerified" flag and distance are ignored.
    const proof = await verifyAttendanceProof(db, session.collegeId, session.uid, body, Date.now(), request);
    if (!proof.ok) {
      return NextResponse.json({ error: proof.error }, { status: proof.status });
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
      ...(proof.distance != null ? { checkOutFaceMatchDistance: proof.distance } : {}),
      checkOutVerified: true,
      checkOutProof: proof.evidence,
      ...(early.early ? {
        earlyCheckOut: {
          reason: earlyReason,
          closingTime: early.closingTime,
          ...(early.permissionIds.length ? { permissionIds: early.permissionIds } : {}),
          ...(early.pendingAdjustmentIds.length ? { adjustmentIds: early.pendingAdjustmentIds } : {}),
          ...(early.periods.length ? { periods: early.periods.map((p) => ({ periodNumber: p.periodNumber, startTime: p.startTime, endTime: p.endTime, subjectName: p.subjectName, coveredBy: p.coveredBy ?? null })) } : {}),
        },
      } : {}),
      updatedAt: new Date(),
    }, { merge: true });

    return NextResponse.json({ ok: true, checkOut: currentTimeHHMM() });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/attendance/check-out POST]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
