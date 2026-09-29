export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { Timestamp } from "firebase-admin/firestore";
import { istDateKey, getISTParts } from "@/lib/attendance/istTime";
import { narrowToActiveLocationDept } from "@/lib/location/activeLocationDept";
import { evaluateCheckInTiming, evaluateCheckOutTiming } from "@/lib/location/shiftTiming";
import type {
  LocationStaffMember,
  LocationStaffAttendanceRecord,
  StaffAttendanceStatus,
  LocationShift,
} from "@/types/locationStaff";

function currentISTTime12h(): string {
  const { hour, minute } = getISTParts(new Date());
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${ampm}`;
}

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

    const date = searchParams.get("date") || istDateKey();
    const departmentId = searchParams.get("departmentId");
    const shiftId = searchParams.get("shiftId");

    const db = getAdminDb();

    // Determine target department
    let targetDeptId = departmentId;
    if (session.role === "LOCATION_DEPT_HEAD") {
      const userDoc = await db.collection("locations").doc(locationId).collection("locationUsers").doc(session.uid).get();
      const udata = (userDoc.data() as { locationDeptId?: string; locationDeptIds?: string[] } | undefined) ?? {};
      const depts = Array.from(
        new Set([...(udata.locationDeptIds ?? []), ...(udata.locationDeptId ? [udata.locationDeptId] : [])])
      );

      // Also check departments where headUid === session.uid or deptHeadUid === session.uid
      const [h1, h2] = await Promise.all([
        db.collection("locations").doc(locationId).collection("locationDepts").where("headUid", "==", session.uid).get(),
        db.collection("locations").doc(locationId).collection("locationDepts").where("deptHeadUid", "==", session.uid).get(),
      ]);
      for (const d of [...h1.docs, ...h2.docs]) {
        if (!depts.includes(d.id)) depts.push(d.id);
      }

      if (!targetDeptId && depts.length > 0) {
        targetDeptId = await narrowToActiveLocationDept(session.uid, depts);
      }
      if (targetDeptId && depts.length > 0 && !depts.includes(targetDeptId)) {
        return NextResponse.json({ error: "Unauthorized for this department" }, { status: 403 });
      }
    }

    // Fetch active staff members
    let staffQuery: FirebaseFirestore.Query = db
      .collection("locations")
      .doc(locationId)
      .collection("staff")
      .where("status", "==", "ACTIVE");

    if (targetDeptId) {
      staffQuery = staffQuery.where("departmentId", "==", targetDeptId);
    }
    if (shiftId && shiftId !== "ALL") {
      staffQuery = staffQuery.where("shiftId", "==", shiftId);
    }

    // Fetch attendance records for this date
    let attQuery: FirebaseFirestore.Query = db
      .collection("locations")
      .doc(locationId)
      .collection("staffAttendance")
      .where("date", "==", date);

    if (targetDeptId) {
      attQuery = attQuery.where("departmentId", "==", targetDeptId);
    }

    const [staffSnap, attSnap] = await Promise.all([staffQuery.get(), attQuery.get()]);

    const attendanceMap = new Map<string, LocationStaffAttendanceRecord>();
    for (const doc of attSnap.docs) {
      const rec = { id: doc.id, ...doc.data() } as LocationStaffAttendanceRecord;
      attendanceMap.set(rec.staffId, rec);
    }

    let present = 0;
    let late = 0;
    let absent = 0;
    let halfDay = 0;
    let onLeave = 0;

    const roster = staffSnap.docs.map((doc) => {
      const staff = { id: doc.id, ...doc.data() } as LocationStaffMember;
      const att = attendanceMap.get(staff.id);

      if (att) {
        if (att.status === "PRESENT") present++;
        else if (att.status === "LATE") late++;
        else if (att.status === "ABSENT") absent++;
        else if (att.status === "HALF_DAY") halfDay++;
        else if (att.status === "ON_LEAVE") onLeave++;
      }

      return {
        staff,
        attendance: att || null,
      };
    });

    // Sort by name
    roster.sort((a, b) => a.staff.name.localeCompare(b.staff.name));

    return NextResponse.json({
      date,
      departmentId: targetDeptId || null,
      shiftId: shiftId || null,
      summary: {
        total: roster.length,
        marked: present + late + absent + halfDay + onLeave,
        present,
        late,
        absent,
        halfDay,
        onLeave,
        pending: roster.length - (present + late + absent + halfDay + onLeave),
      },
      roster,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/staff-attendance GET]", err);
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
      locationId?: string;
      action: "CHECK_IN" | "CHECK_OUT" | "SET_STATUS" | "BULK_MARK" | "UPDATE_RECORD" | "EMERGENCY_ENTRY";
      staffId?: string;
      staffIds?: string[];
      date?: string;
      status?: StaffAttendanceStatus;
      checkInTime?: string;
      checkOutTime?: string;
      shiftId?: string;
      shiftName?: string;
      isEmergencyDuty?: boolean;
      emergencyReason?: string;
      notes?: string;
    };

    const locationId = body.locationId || session.locationId;
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
    }
    if (session.role !== "SUPER_ADMIN" && session.locationId !== locationId) {
      return NextResponse.json({ error: "Unauthorized for this location" }, { status: 403 });
    }

    const date = body.date || istDateKey();
    const db = getAdminDb();
    const now = Timestamp.now();
    const currentISTTime = currentISTTime12h();

    // ── Bulk Mark Action ──────────────────────────────────────────
    if (body.action === "BULK_MARK") {
      if (!body.staffIds || body.staffIds.length === 0 || !body.status) {
        return NextResponse.json({ error: "staffIds and status required for BULK_MARK" }, { status: 400 });
      }

      const batch = db.batch();
      for (const sId of body.staffIds) {
        const staffDoc = await db.collection("locations").doc(locationId).collection("staff").doc(sId).get();
        if (!staffDoc.exists) continue;
        const staffData = staffDoc.data() as LocationStaffMember;

        const docId = `${date}_${sId}`;
        const attRef = db.collection("locations").doc(locationId).collection("staffAttendance").doc(docId);
        const existingSnap = await attRef.get();
        const existing = existingSnap.exists ? (existingSnap.data() as LocationStaffAttendanceRecord) : null;

        const recordPayload: LocationStaffAttendanceRecord = {
          id: docId,
          locationId,
          departmentId: staffData.departmentId,
          staffId: sId,
          staffName: staffData.name,
          staffRole: staffData.role,
          shiftId: staffData.shiftId || "",
          shiftName: staffData.shiftName || "",
          date,
          status: body.status,
          checkInTime: existing?.checkInTime || (body.status === "PRESENT" ? currentISTTime : undefined),
          checkOutTime: existing?.checkOutTime,
          isLate: existing?.isLate || body.status === "LATE",
          isLateCheckIn: existing?.isLateCheckIn || false,
          isOutOfTimeCheckOut: existing?.isOutOfTimeCheckOut || false,
          checkInTimingStatus: existing?.checkInTimingStatus || "ON_TIME",
          checkOutTimingStatus: existing?.checkOutTimingStatus || "ON_TIME",
          isEmergencyDuty: existing?.isEmergencyDuty || false,
          emergencyReason: existing?.emergencyReason || "",
          dutyType: existing?.dutyType || "REGULAR",
          markedByUid: session.uid,
          markedByName: (session as { name?: string }).name || session.email || "Dept Head",
          notes: body.notes || existing?.notes || "",
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };

        batch.set(attRef, recordPayload, { merge: true });
      }

      await batch.commit();
      return NextResponse.json({ ok: true, count: body.staffIds.length });
    }

    // ── Single Staff Member Actions (Atomic Transaction) ────────
    if (!body.staffId) {
      return NextResponse.json({ error: "staffId required" }, { status: 400 });
    }

    const staffRef = db.collection("locations").doc(locationId).collection("staff").doc(body.staffId);
    const docId = `${date}_${body.staffId}`;
    const attRef = db.collection("locations").doc(locationId).collection("staffAttendance").doc(docId);

    // Pre-fetch shift metadata if needed outside the transaction for fast execution
    let preloadedShiftStart = "";
    let preloadedShiftEnd = "";
    let preloadedGrace = 15;
    const shiftToLookup = body.shiftId;
    if (shiftToLookup && shiftToLookup !== "ED" && shiftToLookup !== "EMERGENCY") {
      const sSnap = await db.collection("locations").doc(locationId).collection("shifts").doc(shiftToLookup).get();
      if (sSnap.exists) {
        const sData = sSnap.data() as LocationShift;
        preloadedShiftStart = sData.startTime || "";
        preloadedShiftEnd = sData.endTime || "";
        preloadedGrace = sData.gracePeriodMinutes ?? 15;
      }
    }

    const recordPayload = await db.runTransaction(async (transaction) => {
      const staffDoc = await transaction.get(staffRef);
      if (!staffDoc.exists) {
        throw new Error("NOT_FOUND: Staff member not found");
      }
      const staffData = staffDoc.data() as LocationStaffMember;

      const existingSnap = await transaction.get(attRef);
      const existing = existingSnap.exists ? (existingSnap.data() as LocationStaffAttendanceRecord) : null;

      let updatedStatus: StaffAttendanceStatus = existing?.status || "PRESENT";
      let updatedCheckIn = existing?.checkInTime;
      let updatedCheckOut = existing?.checkOutTime;
      let resolvedShiftId = existing?.shiftId || staffData.shiftId || "";
      let resolvedShiftName = existing?.shiftName || staffData.shiftName || "";
      let isLate = existing?.isLate || false;
      let isLateCheckIn = existing?.isLateCheckIn || false;
      let isOutOfTimeCheckOut = existing?.isOutOfTimeCheckOut || false;
      let checkInTimingStatus = existing?.checkInTimingStatus || "ON_TIME";
      let checkOutTimingStatus = existing?.checkOutTimingStatus || "ON_TIME";
      let isEmergencyDuty = existing?.isEmergencyDuty || false;
      let emergencyReason = existing?.emergencyReason || "";
      let dutyType = existing?.dutyType || "REGULAR";

      // ── Emergency Entry or Action ──
      const isEmergencyRequest =
        body.action === "EMERGENCY_ENTRY" ||
        body.isEmergencyDuty === true ||
        body.shiftId === "EMERGENCY" ||
        body.shiftName?.toLowerCase().includes("emergency");

      if (isEmergencyRequest) {
        isEmergencyDuty = true;
        dutyType = "EMERGENCY";
        resolvedShiftId = "EMERGENCY";
        resolvedShiftName = "Emergency Duty (ED)";
        emergencyReason = body.emergencyReason || body.notes || "Urgent emergency duty deployment";
        updatedCheckIn = body.checkInTime || currentISTTime;
        updatedStatus = "PRESENT";
        isLateCheckIn = false;
        isLate = false;
        checkInTimingStatus = "ON_TIME";
      } else if (body.action === "CHECK_IN") {
        if (body.shiftId !== undefined) {
          resolvedShiftId = body.shiftId;
          resolvedShiftName = body.shiftName || (body.shiftId === "ED" ? "Extra Duty (ED)" : "");
        }
        if (!resolvedShiftId) {
          throw new Error("BAD_REQUEST: Select a shift or Emergency Duty (ED) to check in");
        }

        updatedCheckIn = body.checkInTime || currentISTTime;

        if (preloadedShiftStart) {
          const timingEval = evaluateCheckInTiming(updatedCheckIn, preloadedShiftStart, preloadedGrace);
          if (timingEval.isLate) {
            isLateCheckIn = true;
            isLate = true;
            updatedStatus = "LATE";
            checkInTimingStatus = "LATE";
          } else {
            isLateCheckIn = false;
            checkInTimingStatus = timingEval.timingStatus;
            if (!existing || existing.status === "ABSENT") {
              updatedStatus = "PRESENT";
            }
          }
        } else {
          if (!existing || existing.status === "ABSENT") {
            updatedStatus = "PRESENT";
          }
        }
      } else if (body.action === "CHECK_OUT") {
        updatedCheckOut = body.checkOutTime || currentISTTime;

        if (preloadedShiftEnd) {
          const timingEval = evaluateCheckOutTiming(updatedCheckOut, preloadedShiftStart, preloadedShiftEnd);
          if (timingEval.isOutOfTime) {
            isOutOfTimeCheckOut = true;
            checkOutTimingStatus = timingEval.timingStatus;
            isLate = true;
            if (updatedStatus === "PRESENT") {
              updatedStatus = "LATE";
            }
          } else {
            isOutOfTimeCheckOut = false;
            checkOutTimingStatus = "ON_TIME";
          }
        }
      } else if (body.action === "SET_STATUS") {
        if (!body.status) throw new Error("BAD_REQUEST: status required");
        updatedStatus = body.status;
        if (body.status === "LATE") {
          isLate = true;
          if (!updatedCheckIn) updatedCheckIn = currentISTTime;
        } else if (body.status === "PRESENT" && !updatedCheckIn) {
          updatedCheckIn = currentISTTime;
        }
      } else if (body.action === "UPDATE_RECORD") {
        if (body.status) updatedStatus = body.status;
        if (body.checkInTime !== undefined) updatedCheckIn = body.checkInTime;
        if (body.checkOutTime !== undefined) updatedCheckOut = body.checkOutTime;
      }

      const payload: LocationStaffAttendanceRecord = {
        id: docId,
        locationId,
        departmentId: staffData.departmentId,
        staffId: body.staffId!,
        staffName: staffData.name,
        staffRole: staffData.role,
        shiftId: resolvedShiftId,
        shiftName: resolvedShiftName,
        date,
        status: updatedStatus,
        checkInTime: updatedCheckIn,
        checkOutTime: updatedCheckOut,
        isLate,
        isLateCheckIn,
        isOutOfTimeCheckOut,
        checkInTimingStatus,
        checkOutTimingStatus,
        isEmergencyDuty,
        emergencyReason,
        dutyType,
        markedByUid: session.uid,
        markedByName: (session as { name?: string }).name || session.email || "Dept Head",
        notes: body.notes !== undefined ? body.notes : (existing?.notes || ""),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      transaction.set(attRef, payload, { merge: true });
      return payload;
    });

    return NextResponse.json({ ok: true, record: recordPayload });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.startsWith("NOT_FOUND:")) {
        return NextResponse.json({ error: err.message.replace("NOT_FOUND: ", "") }, { status: 404 });
      }
      if (err.message.startsWith("BAD_REQUEST:")) {
        return NextResponse.json({ error: err.message.replace("BAD_REQUEST: ", "") }, { status: 400 });
      }
      if (err.message === "UNAUTHORIZED") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
    console.error("[location/staff-attendance POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
