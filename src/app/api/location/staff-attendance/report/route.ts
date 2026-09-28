export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { istDateKey } from "@/lib/attendance/istTime";
import type { LocationStaffAttendanceRecord, LocationStaffMember } from "@/types/locationStaff";

interface StaffReportRow {
  staffId: string;
  staffName: string;
  role: string;
  departmentName: string;
  shiftName: string;
  present: number;
  late: number;
  absent: number;
  halfDay: number;
  onLeave: number;
  marked: number;
  attendancePercent: number;
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

    const today = istDateKey();
    const to = searchParams.get("to") || today;
    const from = searchParams.get("from") || to;
    const departmentId = searchParams.get("departmentId");
    const shiftId = searchParams.get("shiftId");

    const db = getAdminDb();

    let staffQuery: FirebaseFirestore.Query = db.collection("locations").doc(locationId).collection("staff");
    if (departmentId && departmentId !== "ALL") {
      staffQuery = staffQuery.where("departmentId", "==", departmentId);
    }
    if (shiftId && shiftId !== "ALL") {
      staffQuery = staffQuery.where("shiftId", "==", shiftId);
    }

    const attQuery = db
      .collection("locations")
      .doc(locationId)
      .collection("staffAttendance")
      .where("date", ">=", from)
      .where("date", "<=", to);

    const [staffSnap, attSnap] = await Promise.all([staffQuery.get(), attQuery.get()]);

    const attendanceByStaff = new Map<string, LocationStaffAttendanceRecord[]>();
    for (const doc of attSnap.docs) {
      const rec = doc.data() as LocationStaffAttendanceRecord;
      const list = attendanceByStaff.get(rec.staffId) ?? [];
      list.push(rec);
      attendanceByStaff.set(rec.staffId, list);
    }

    const rows: StaffReportRow[] = staffSnap.docs.map((doc) => {
      const staff = { id: doc.id, ...doc.data() } as LocationStaffMember;
      const records = attendanceByStaff.get(staff.id) ?? [];

      let present = 0;
      let late = 0;
      let absent = 0;
      let halfDay = 0;
      let onLeave = 0;
      for (const rec of records) {
        if (rec.status === "PRESENT") present++;
        else if (rec.status === "LATE") late++;
        else if (rec.status === "ABSENT") absent++;
        else if (rec.status === "HALF_DAY") halfDay++;
        else if (rec.status === "ON_LEAVE") onLeave++;
      }
      const marked = present + late + absent + halfDay + onLeave;
      const attendancePercent = marked > 0 ? Math.round(((present + late + halfDay * 0.5) / marked) * 100) : 0;

      return {
        staffId: staff.id,
        staffName: staff.name,
        role: staff.role,
        departmentName: staff.departmentName || "Unassigned",
        shiftName: staff.shiftName || "Flexible",
        present,
        late,
        absent,
        halfDay,
        onLeave,
        marked,
        attendancePercent,
      };
    });

    rows.sort((a, b) => a.staffName.localeCompare(b.staffName));

    return NextResponse.json({ from, to, rows });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[location/staff-attendance/report GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
