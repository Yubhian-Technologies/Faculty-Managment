export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { closeMissedCheckouts, toAttendanceDate } from "@/lib/attendance/closeMissedCheckouts";
import type { AttendanceRecord, AttendanceSummary } from "@/types";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "HOD",
      "PRINCIPAL",
      "SUPER_ADMIN",
      "PANEL_MEMBER",
      "VICE_PRINCIPAL",
    );

    const { searchParams } = new URL(request.url);
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // Fetch monthly attendance summary by computed doc id
    const summaryId = `${session.uid}_${year}_${month}`;
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
      .where("facultyId", "==", session.uid)
      .get();

    // Filter in-memory to the requested year + month
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
      summary,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit ref/resolvedDate from the response
      records: records.map(({ ref: _ref, resolvedDate: _resolvedDate, ...rec }) => rec),
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
