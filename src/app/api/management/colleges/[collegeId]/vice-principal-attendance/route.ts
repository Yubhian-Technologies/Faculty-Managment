export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { closeMissedCheckouts, toAttendanceDate } from "@/lib/attendance/closeMissedCheckouts";
import { fillMissingDays } from "@/lib/attendance/fillMissingDays";
import { istMonthBounds, getISTParts } from "@/lib/attendance/istTime";
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
    const nowIST = getISTParts();
    const year = parseInt(searchParams.get("year") ?? String(nowIST.year), 10);
    const month = parseInt(searchParams.get("month") ?? String(nowIST.month), 10);

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(collegeId);

    const vpSnap = await collegeRef.collection("users").where("role", "==", "VICE_PRINCIPAL").limit(1).get();
    if (vpSnap.empty) {
      return NextResponse.json({ vicePrincipalName: null, registered: false, summary: null, records: [] });
    }
    const vpDoc = vpSnap.docs[0];
    const vpUid = vpDoc.id;
    const vpData = vpDoc.data() as { name?: string; department?: string; faceEmbedding?: number[]; faceRegisteredAt?: FirebaseFirestore.Timestamp };
    const vicePrincipalName = vpData.name ?? "";
    const registered = Array.isArray(vpData.faceEmbedding) && vpData.faceEmbedding.length > 0;
    const registeredAt = vpData.faceRegisteredAt ? vpData.faceRegisteredAt.toDate() : null;

    const summaryId = `${vpUid}_${year}_${month}`;
    const summarySnap = await collegeRef.collection("attendanceSummaries").doc(summaryId).get();
    const summary: (AttendanceSummary & { id: string }) | null = summarySnap.exists
      ? ({ id: summarySnap.id, ...summarySnap.data() } as AttendanceSummary & { id: string })
      : null;

    const recordsSnap = await collegeRef.collection("attendanceRecords").where("facultyId", "==", vpUid).get();

    const { monthStart, monthEnd } = istMonthBounds(year, month);

    const records: (AttendanceRecord & { id: string; ref: FirebaseFirestore.DocumentReference; resolvedDate: Date | null })[] = recordsSnap.docs
      .map((d) => {
        const data = d.data() as AttendanceRecord;
        return { ...data, id: d.id, ref: d.ref, resolvedDate: toAttendanceDate(data.date) };
      })
      .filter((rec) => rec.resolvedDate !== null && rec.resolvedDate >= monthStart && rec.resolvedDate < monthEnd)
      .sort((a, b) => (a.resolvedDate?.getTime() ?? 0) - (b.resolvedDate?.getTime() ?? 0));

    await closeMissedCheckouts(db, records);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit ref/resolvedDate from the real records
    const realRecords = records.map(({ ref: _ref, resolvedDate: _resolvedDate, ...rec }) => rec);
    const filledRecords = fillMissingDays(realRecords, monthStart, monthEnd, registeredAt, {
      collegeId, facultyId: vpUid, facultyName: vicePrincipalName, department: vpData.department ?? "",
    });

    return NextResponse.json({
      vicePrincipalName,
      registered,
      summary,
      records: filledRecords,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/colleges/vice-principal-attendance GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
