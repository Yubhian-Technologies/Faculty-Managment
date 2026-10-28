export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { istDateFromParts, istDateKey } from "@/lib/attendance/istTime";
import { getNoClassReason } from "@/lib/studentAttendance/classDay";
import { getHolidayNameForDate } from "@/lib/leave/holidaysCount";

// Is TODAY a holiday for the signed-in person? Drives the "Today is a holiday"
// notice on every timetable page (components/timetable/TodayHolidayBanner.tsx).
// Students (and class leaders) get the class calendar's answer - holiday,
// suspension, sem break, summer break, Sunday; staff only a holiday that
// applies to faculty, since a students-only holiday or sem break leaves
// faculty working.
export async function GET() {
  try {
    const session = await requireCollegeMember(
      "STUDENT", "CLASS_LEADER",
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "COLLEGE_ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "ACADEMICS", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "RND_COORDINATOR",
      "LIBRARY", "HOSTEL", "PD", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const isStudent = session.role === "STUDENT" || session.role === "CLASS_LEADER";
    const db = getAdminDb();
    const today = istDateKey();

    let reason: string | null;
    if (isStudent) {
      reason = await getNoClassReason(db, session.collegeId, today);
    } else {
      const name = await getHolidayNameForDate(db, session.collegeId, new Date());
      reason = name === null ? null : name ? `Holiday: ${name}` : "Holiday";
    }
    if (!reason) return NextResponse.json({ date: today, holiday: false });

    // Hostellers' outing flag, when a declared holiday today states one.
    const [y, m, d] = today.split("-").map(Number);
    const start = istDateFromParts(y, m, d);
    const snap = await db.collection("colleges").doc(session.collegeId).collection("holidays")
      .where("date", ">=", start).where("date", "<", new Date(start.getTime() + 24 * 60 * 60 * 1000)).get();
    const outing = snap.docs
      .map((doc) => (doc.data() as { hostelersOutingAllowed?: boolean }).hostelersOutingAllowed)
      .find((v) => v != null);

    return NextResponse.json({ date: today, holiday: true, reason, ...(outing != null ? { hostelersOutingAllowed: outing } : {}) });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/holidays/today GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
