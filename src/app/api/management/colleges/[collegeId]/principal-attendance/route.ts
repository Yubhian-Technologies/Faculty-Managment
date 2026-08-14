export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
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
      return NextResponse.json({ principalName: null, summary: null, records: [] });
    }
    const principalDoc = principalSnap.docs[0];
    const principalUid = principalDoc.id;
    const principalName = (principalDoc.data() as { name?: string }).name ?? "";

    const summaryId = `${principalUid}_${year}_${month}`;
    const summarySnap = await collegeRef.collection("attendanceSummaries").doc(summaryId).get();
    const summary: (AttendanceSummary & { id: string }) | null = summarySnap.exists
      ? ({ id: summarySnap.id, ...summarySnap.data() } as AttendanceSummary & { id: string })
      : null;

    const recordsSnap = await collegeRef.collection("attendanceRecords").where("facultyId", "==", principalUid).get();

    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1); // exclusive

    const records: (AttendanceRecord & { id: string })[] = recordsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as AttendanceRecord & { id: string }))
      .filter((rec) => {
        const d: Date =
          rec.date && typeof (rec.date as { toDate?: () => Date }).toDate === "function"
            ? (rec.date as { toDate: () => Date }).toDate()
            : new Date(rec.date as unknown as string);
        return d >= monthStart && d < monthEnd;
      })
      .sort((a, b) => {
        const da =
          a.date && typeof (a.date as { toMillis?: () => number }).toMillis === "function"
            ? (a.date as { toMillis: () => number }).toMillis()
            : new Date(a.date as unknown as string).getTime();
        const db_ =
          b.date && typeof (b.date as { toMillis?: () => number }).toMillis === "function"
            ? (b.date as { toMillis: () => number }).toMillis()
            : new Date(b.date as unknown as string).getTime();
        return da - db_;
      });

    return NextResponse.json({ principalName, summary, records });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/colleges/principal-attendance GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
