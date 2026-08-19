export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { closeMissedCheckouts, toAttendanceDate } from "@/lib/attendance/closeMissedCheckouts";
import { fillMissingDays } from "@/lib/attendance/fillMissingDays";
import { resolveFaceRegisteredAt } from "@/lib/attendance/registration";
import { getWorkingDayWeightsForRole } from "@/lib/attendance/workingDays";
import type { AttendanceRecord, AttendanceSummary, UserRole } from "@/types";

// MANAGEMENT is read-only - this route only implements GET.
// Same attendanceRecords/attendanceSummaries collections and month-window
// logic as an HOD/Principal reviewing a Faculty/HOD's month (see
// /api/college/attendance GET with ?facultyId=), just resolved by an
// explicit collegeId + uid (URL params) since Management's session isn't
// scoped to any one college - mirrors the college-id resolution pattern
// already used by principal-attendance / vice-principal-attendance.
export async function GET(request: Request, { params }: { params: Promise<{ collegeId: string; uid: string }> }) {
  try {
    await requireManagement();
    const { collegeId, uid } = await params;
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(collegeId);

    const userSnap = await collegeRef.collection("users").doc(uid).get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }
    const user = userSnap.data() as { name?: string; department?: string; role?: string };
    if (user.role !== "HOD" && user.role !== "PANEL_MEMBER") {
      return NextResponse.json({ error: "Not a Faculty/HOD account" }, { status: 400 });
    }
    const personName = user.name ?? "";
    const department = user.department ?? "";

    const registeredAt = await resolveFaceRegisteredAt(db, collegeId, uid, user.role);

    const summaryId = `${uid}_${year}_${month}`;
    const summarySnap = await collegeRef.collection("attendanceSummaries").doc(summaryId).get();
    const summary: (AttendanceSummary & { id: string }) | null = summarySnap.exists
      ? ({ id: summarySnap.id, ...summarySnap.data() } as AttendanceSummary & { id: string })
      : null;

    const recordsSnap = await collegeRef.collection("attendanceRecords").where("facultyId", "==", uid).get();

    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1); // exclusive

    const records: (AttendanceRecord & { id: string; ref: FirebaseFirestore.DocumentReference; resolvedDate: Date | null })[] = recordsSnap.docs
      .map((d) => {
        const data = d.data() as AttendanceRecord;
        return { ...data, id: d.id, ref: d.ref, resolvedDate: toAttendanceDate(data.date) };
      })
      .filter((rec) => rec.resolvedDate !== null && rec.resolvedDate >= monthStart && rec.resolvedDate < monthEnd)
      .sort((a, b) => (a.resolvedDate?.getTime() ?? 0) - (b.resolvedDate?.getTime() ?? 0));

    await closeMissedCheckouts(db, records);

    const workingDayDates = new Set(
      (await getWorkingDayWeightsForRole(db, collegeId, monthStart, monthEnd, user.role as UserRole)).keys()
    );

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit ref/resolvedDate from the real records
    const realRecords = records.map(({ ref: _ref, resolvedDate: _resolvedDate, ...rec }) => rec);
    const filledRecords = fillMissingDays(realRecords, monthStart, monthEnd, registeredAt, {
      collegeId, facultyId: uid, facultyName: personName, department,
    }, new Date(), workingDayDates);

    return NextResponse.json({
      personName,
      registered: !!registeredAt,
      summary,
      records: filledRecords,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/colleges/faculty-attendance GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
