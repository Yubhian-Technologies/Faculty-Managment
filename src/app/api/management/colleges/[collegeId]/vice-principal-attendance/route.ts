export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { closeMissedCheckouts, toAttendanceDate } from "@/lib/attendance/closeMissedCheckouts";
import type { AttendanceRecord, AttendanceSummary } from "@/types";

// MANAGEMENT is read-only - this route only implements GET.
// Same shape as GET /api/management/colleges/[collegeId]/principal-attendance,
// just resolved by that college's VICE_PRINCIPAL user instead of PRINCIPAL -
// see that route for the full rationale.
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

    const vpSnap = await collegeRef.collection("users").where("role", "==", "VICE_PRINCIPAL").limit(1).get();
    if (vpSnap.empty) {
      return NextResponse.json({ vicePrincipalName: null, summary: null, records: [] });
    }
    const vpDoc = vpSnap.docs[0];
    const vpUid = vpDoc.id;
    const vicePrincipalName = (vpDoc.data() as { name?: string }).name ?? "";

    const summaryId = `${vpUid}_${year}_${month}`;
    const summarySnap = await collegeRef.collection("attendanceSummaries").doc(summaryId).get();
    const summary: (AttendanceSummary & { id: string }) | null = summarySnap.exists
      ? ({ id: summarySnap.id, ...summarySnap.data() } as AttendanceSummary & { id: string })
      : null;

    const recordsSnap = await collegeRef.collection("attendanceRecords").where("facultyId", "==", vpUid).get();

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

    return NextResponse.json({
      vicePrincipalName,
      summary,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit ref/resolvedDate from the response
      records: records.map(({ ref: _ref, resolvedDate: _resolvedDate, ...rec }) => rec),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/colleges/vice-principal-attendance GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
