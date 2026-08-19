export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { closeMissedCheckouts, toAttendanceDate } from "@/lib/attendance/closeMissedCheckouts";
import { fillMissingDays } from "@/lib/attendance/fillMissingDays";
import { getWorkingDayWeightsForRole } from "@/lib/attendance/workingDays";
import type { AttendanceRecord, AttendanceSummary } from "@/types";

// MANAGEMENT is read-only - this route only implements GET.
// Same attendanceRecords/attendanceSummaries collections and month-window
// logic as the Principal's own "My Attendance" (see /api/college/attendance
// GET), just resolved by collegeId (URL param) + that college's PRINCIPAL
// user instead of session.uid, since Management's session isn't scoped to
// any one college (mirrors the "first matching college-scoped user for a
// role" resolution already used by /api/management/colleges/[collegeId]/staff).
export async function GET(request: Request, { params }: { params: Promise<{ collegeId: string }> }) {
  try {
    await requireManagement();
    const { collegeId } = await params;
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(collegeId);

    const principalSnap = await collegeRef.collection("users").where("role", "==", "PRINCIPAL").limit(1).get();
    if (principalSnap.empty) {
      return NextResponse.json({ principalName: null, registered: false, summary: null, records: [] });
    }
    const principalDoc = principalSnap.docs[0];
    const principalUid = principalDoc.id;
    const principalData = principalDoc.data() as { name?: string; department?: string; faceEmbedding?: number[]; faceRegisteredAt?: FirebaseFirestore.Timestamp };
    const principalName = principalData.name ?? "";
    const registered = Array.isArray(principalData.faceEmbedding) && principalData.faceEmbedding.length > 0;
    const registeredAt = principalData.faceRegisteredAt ? principalData.faceRegisteredAt.toDate() : null;

    const summaryId = `${principalUid}_${year}_${month}`;
    const summarySnap = await collegeRef.collection("attendanceSummaries").doc(summaryId).get();
    const summary: (AttendanceSummary & { id: string }) | null = summarySnap.exists
      ? ({ id: summarySnap.id, ...summarySnap.data() } as AttendanceSummary & { id: string })
      : null;

    const recordsSnap = await collegeRef.collection("attendanceRecords").where("facultyId", "==", principalUid).get();

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
      (await getWorkingDayWeightsForRole(db, collegeId, monthStart, monthEnd, "PRINCIPAL")).keys()
    );

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit ref/resolvedDate from the real records
    const realRecords = records.map(({ ref: _ref, resolvedDate: _resolvedDate, ...rec }) => rec);
    const filledRecords = fillMissingDays(realRecords, monthStart, monthEnd, registeredAt, {
      collegeId, facultyId: principalUid, facultyName: principalName, department: principalData.department ?? "",
    }, new Date(), workingDayDates);

    return NextResponse.json({
      principalName,
      registered,
      summary,
      records: filledRecords,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/colleges/principal-attendance GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
