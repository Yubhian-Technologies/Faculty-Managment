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
// faculty working - though staff are told that no classes run then (`classesOff`).
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

    // Today's declared holidays (any audience) - the hostellers' outing flag, and for staff a students-only one.
    const [y, m, d] = today.split("-").map(Number);
    const start = istDateFromParts(y, m, d);
    const snap = await db.collection("colleges").doc(session.collegeId).collection("holidays")
      .where("date", ">=", start).where("date", "<", new Date(start.getTime() + 24 * 60 * 60 * 1000)).get();
    const declared = snap.docs.map((doc) => doc.data() as { name?: string; appliesTo?: string; category?: string; hostelersOutingAllowed?: boolean });
    const outing = declared.map((h) => h.hostelersOutingAllowed).find((v) => v != null);

    let reason: string | null;
    if (isStudent) {
      reason = await getNoClassReason(db, session.collegeId, today);
    } else {
      const name = await getHolidayNameForDate(db, session.collegeId, new Date());
      reason = name === null ? null : name ? `Holiday: ${name}` : "Holiday";
    }
    if (!reason) {
      // Staff: a students-only holiday / class suspension is a working day, but no classes run.
      const studentsOnly = !isStudent ? declared.find((h) => h.appliesTo === "STUDENTS") : undefined;
      if (studentsOnly) {
        return NextResponse.json({
          date: today, holiday: false, classesOff: true,
          reason: `${studentsOnly.category === "CLASS_SUSPENDED" ? "Classes suspended" : "Holiday for students"}${studentsOnly.name ? `: ${studentsOnly.name}` : ""}`,
        });
      }
      return NextResponse.json({ date: today, holiday: false });
    }

    return NextResponse.json({ date: today, holiday: true, reason, ...(outing != null ? { hostelersOutingAllowed: outing } : {}) });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    }
    console.error("[college/holidays/today GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
