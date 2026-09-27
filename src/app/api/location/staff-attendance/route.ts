export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { Timestamp } from "firebase-admin/firestore";
import { istDateKey, getISTParts } from "@/lib/attendance/istTime";
import { narrowToActiveLocationDept } from "@/lib/location/activeLocationDept";
import type {
  LocationStaffMember,
  LocationStaffAttendanceRecord,
  StaffAttendanceStatus,
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
    let absent = 0;
    let halfDay = 0;
    let onLeave = 0;

    const roster = staffSnap.docs.map((doc) => {
      const staff = { id: doc.id, ...doc.data() } as LocationStaffMember;
      const att = attendanceMap.get(staff.id);

      if (att) {
        if (att.status === "PRESENT") present++;
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
        marked: present + absent + halfDay + onLeave,
        present,
        absent,
        halfDay,
        onLeave,
        pending: roster.length - (present + absent + halfDay + onLeave),
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
      action: "CHECK_IN" | "CHECK_OUT" | "SET_STATUS" | "BULK_MARK" | "UPDATE_RECORD";
      staffId?: string;
      staffIds?: string[];
      date?: string;
      status?: StaffAttendanceStatus;
      checkInTime?: string;
      checkOutTime?: string;
      notes?: string;
    };

    const locationId = body.locationId || session.locationId;
    if (!locationId) {
      return NextResponse.json({ error: "locationId required" }, { status: 400 });
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

    // ── Single Staff Member Actions ──────────────────────────────
    if (!body.staffId) {
      return NextResponse.json({ error: "staffId required" }, { status: 400 });
    }

    const staffDoc = await db.collection("locations").doc(locationId).collection("staff").doc(body.staffId).get();
    if (!staffDoc.exists) {
      return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    }
    const staffData = staffDoc.data() as LocationStaffMember;

    const docId = `${date}_${body.staffId}`;
    const attRef = db.collection("locations").doc(locationId).collection("staffAttendance").doc(docId);
    const existingSnap = await attRef.get();
    const existing = existingSnap.exists ? (existingSnap.data() as LocationStaffAttendanceRecord) : null;

    let updatedStatus: StaffAttendanceStatus = existing?.status || "PRESENT";
    let updatedCheckIn = existing?.checkInTime;
    let updatedCheckOut = existing?.checkOutTime;

    if (body.action === "CHECK_IN") {
      updatedCheckIn = body.checkInTime || currentISTTime;
      if (!existing || existing.status === "ABSENT") {
        updatedStatus = "PRESENT";
      }
    } else if (body.action === "CHECK_OUT") {
      updatedCheckOut = body.checkOutTime || currentISTTime;
      if (!existing) {
        updatedStatus = "PRESENT";
      }
    } else if (body.action === "SET_STATUS") {
      if (!body.status) return NextResponse.json({ error: "status required" }, { status: 400 });
      updatedStatus = body.status;
      if (body.status === "PRESENT" && !updatedCheckIn) {
        updatedCheckIn = currentISTTime;
      }
    } else if (body.action === "UPDATE_RECORD") {
      if (body.status) updatedStatus = body.status;
      if (body.checkInTime !== undefined) updatedCheckIn = body.checkInTime;
      if (body.checkOutTime !== undefined) updatedCheckOut = body.checkOutTime;
    }

    const recordPayload: LocationStaffAttendanceRecord = {
      id: docId,
      locationId,
      departmentId: staffData.departmentId,
      staffId: body.staffId,
      staffName: staffData.name,
      staffRole: staffData.role,
      shiftId: staffData.shiftId || "",
      shiftName: staffData.shiftName || "",
      date,
      status: updatedStatus,
      checkInTime: updatedCheckIn,
      checkOutTime: updatedCheckOut,
      markedByUid: session.uid,
      markedByName: (session as { name?: string }).name || session.email || "Dept Head",
      notes: body.notes !== undefined ? body.notes : (existing?.notes || ""),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await attRef.set(recordPayload, { merge: true });

    return NextResponse.json({ ok: true, record: recordPayload });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/staff-attendance POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
