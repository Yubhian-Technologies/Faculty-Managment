export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { closeMissedCheckouts, toAttendanceDate } from "@/lib/attendance/closeMissedCheckouts";
import { fillMissingDays } from "@/lib/attendance/fillMissingDays";
import { istMonthBounds, getISTParts } from "@/lib/attendance/istTime";
import { resolveFaceRegisteredAt } from "@/lib/attendance/registration";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { unitLabelForHeadRole, isCollegeStaffUnitHead, COLLEGE_STAFF_UNIT_HEAD_ROLES } from "@/lib/attendance/collegeStaffUnits";
import type { AttendanceRecord, AttendanceSummary } from "@/types";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "HOD",
      "PRINCIPAL",
      "SUPER_ADMIN",
      "PANEL_MEMBER",
      "VICE_PRINCIPAL",
      "COLLEGE_STAFF",
      ...COLLEGE_STAFF_UNIT_HEAD_ROLES,
    );

    const { searchParams } = new URL(request.url);
    const nowIST = getISTParts();
    const year = parseInt(searchParams.get("year") ?? String(nowIST.year), 10);
    const month = parseInt(searchParams.get("month") ?? String(nowIST.month), 10);

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // Viewing someone else's month (the monthly per-person view HOD/Principal/
    // VP use to review and correct a whole month, not just today) - same
    // one-tier cascade as /api/college/attendance/manual: HOD -> same-
    // department Faculty, PRINCIPAL/VICE_PRINCIPAL -> an HOD in this college.
    const requestedFacultyId = searchParams.get("facultyId")?.trim();
    let facultyId = session.uid;
    let facultyRole: string = session.role;
    let facultyName = "";
    let department = "";
    let personName: string | null = null;

    if (requestedFacultyId && requestedFacultyId !== session.uid) {
      if (
        session.role !== "HOD" &&
        session.role !== "PRINCIPAL" &&
        session.role !== "VICE_PRINCIPAL" &&
        !isCollegeStaffUnitHead(session.role)
      ) {
        return NextResponse.json({ error: "You can only view your own attendance" }, { status: 403 });
      }
      const targetSnap = await collegeRef.collection("users").doc(requestedFacultyId).get();
      if (!targetSnap.exists) {
        return NextResponse.json({ error: "Person not found" }, { status: 404 });
      }
      const target = targetSnap.data() as { name?: string; department?: string; role?: string };
      if (session.role === "HOD") {
        if (target.role !== "PANEL_MEMBER") {
          return NextResponse.json({ error: "You can only view attendance for Faculty" }, { status: 403 });
        }
        const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
        if (!canHodEditDepartment(scope, target.department ?? "")) {
          return NextResponse.json({ error: "You can only view attendance for faculty in your department" }, { status: 403 });
        }
      } else if (isCollegeStaffUnitHead(session.role)) {
        // Unit head (College Office / Exam Cell / Library / T&P / ...): view
        // a COLLEGE_STAFF member belonging to their own unit - same
        // department-string link the roster/report and manual-mark routes
        // use (see collegeStaffUnits.ts).
        if (target.role !== "COLLEGE_STAFF" || target.department !== unitLabelForHeadRole(session.role)) {
          return NextResponse.json({ error: "You can only view attendance for staff in your unit" }, { status: 403 });
        }
      } else if (target.role !== "HOD" && !isCollegeStaffUnitHead(target.role ?? "")) {
        return NextResponse.json({ error: "You can only view attendance for an HOD or unit head" }, { status: 403 });
      }
      facultyId = requestedFacultyId;
      facultyRole = target.role ?? "";
      facultyName = target.name ?? "";
      department = target.department ?? "";
      personName = facultyName;
    } else {
      const selfSnap = await collegeRef.collection("users").doc(session.uid).get();
      const self = selfSnap.data() as { name?: string; department?: string } | undefined;
      facultyName = self?.name ?? "";
      department = self?.department ?? "";
    }

    // Fetch monthly attendance summary by computed doc id
    const summaryId = `${facultyId}_${year}_${month}`;
    const summarySnap = await collegeRef
      .collection("attendanceSummaries")
      .doc(summaryId)
      .get();

    const summary: (AttendanceSummary & { id: string }) | null = summarySnap.exists
      ? ({ id: summarySnap.id, ...summarySnap.data() } as AttendanceSummary & { id: string })
      : null;

    // Fetch all attendance records for this faculty member
    const recordsSnap = await collegeRef
      .collection("attendanceRecords")
      .where("facultyId", "==", facultyId)
      .get();

    // Filter in-memory to the requested year + month
    const { monthStart, monthEnd } = istMonthBounds(year, month);

    const records: (AttendanceRecord & { id: string; ref: FirebaseFirestore.DocumentReference; resolvedDate: Date | null })[] = recordsSnap.docs
      .map((d) => {
        const data = d.data() as AttendanceRecord;
        return { ...data, id: d.id, ref: d.ref, resolvedDate: toAttendanceDate(data.date) };
      })
      .filter((rec) => rec.resolvedDate !== null && rec.resolvedDate >= monthStart && rec.resolvedDate < monthEnd)
      .sort((a, b) => (a.resolvedDate?.getTime() ?? 0) - (b.resolvedDate?.getTime() ?? 0));

    await closeMissedCheckouts(db, records);

    const registeredAt = await resolveFaceRegisteredAt(db, session.collegeId, facultyId, facultyRole);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit ref/resolvedDate from the real records
    const realRecords = records.map(({ ref: _ref, resolvedDate: _resolvedDate, ...rec }) => rec);
    const filledRecords = fillMissingDays(realRecords, monthStart, monthEnd, registeredAt, {
      collegeId: session.collegeId,
      facultyId,
      facultyName,
      department,
    });

    return NextResponse.json({
      personName,
      registered: !!registeredAt,
      summary,
      records: filledRecords,
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
