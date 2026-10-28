export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { istDateFromParts, istDateKey } from "@/lib/attendance/istTime";
import { addDaysKey } from "@/lib/college/holidayCalendar";
import { HOLIDAY_CATEGORY_LABELS, SEM_BREAK_LABELS } from "@/types";
import type { HolidayCategory, SemBreakKind, UpcomingNotice } from "@/types";

// What changes TOMORROW for the signed-in person - drives the "tomorrow is a
// holiday" pop-up shown at login (components/layout/HolidayReminder.tsx). Every
// role that can sign in to a college may read it; each only gets what applies
// to them: students see every holiday and their sem breaks, staff skip
// students-only holidays and sem breaks (faculty keep working through those).
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
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const tomorrow = addDaysKey(istDateKey(), 1);
    const [y, m, d] = tomorrow.split("-").map(Number);
    const start = istDateFromParts(y, m, d);
    const endExclusive = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const [holidaySnap, compSnap, breakSnap] = await Promise.all([
      collegeRef.collection("holidays").where("date", ">=", start).where("date", "<", endExclusive).get(),
      collegeRef.collection("holidays").where("compensatoryDateKey", "==", tomorrow).get(),
      isStudent
        ? collegeRef.collection("semBreaks").where("fromDate", ">=", start).where("fromDate", "<", endExclusive).get()
        : Promise.resolve(null),
    ]);

    const notices: UpcomingNotice[] = [];
    for (const doc of holidaySnap.docs) {
      const h = doc.data() as { name?: string; appliesTo?: string; category?: HolidayCategory; hostelersOutingAllowed?: boolean };
      if (!isStudent && h.appliesTo === "STUDENTS") continue;
      const category = h.category ?? "REGULAR";
      notices.push({
        id: doc.id,
        kind: category,
        label: HOLIDAY_CATEGORY_LABELS[category],
        title: h.name ?? "Holiday",
        ...(h.hostelersOutingAllowed != null ? { hostelersOutingAllowed: h.hostelersOutingAllowed } : {}),
      });
    }
    for (const doc of compSnap.docs) {
      const h = doc.data() as { name?: string; compensatoryEnabled?: boolean; compensatoryFollowsDay?: string };
      if (!h.compensatoryEnabled) continue;
      notices.push({
        id: `comp_${doc.id}`,
        kind: "COMPENSATORY_WORKING_DAY",
        label: "Compensatory Working Day",
        title: `Tomorrow (Sunday) is a working day in place of ${h.name ?? "the compensatory holiday"}`,
        followsDay: h.compensatoryFollowsDay,
      });
    }
    for (const doc of breakSnap?.docs ?? []) {
      const b = doc.data() as { kind: SemBreakKind; toDate: { toDate(): Date }; hostelersOutingAllowed?: boolean };
      notices.push({
        id: `sem_${doc.id}`,
        kind: "SEM_BREAK",
        label: SEM_BREAK_LABELS[b.kind],
        title: SEM_BREAK_LABELS[b.kind],
        untilKey: istDateKey(b.toDate.toDate()),
        hostelersOutingAllowed: b.hostelersOutingAllowed,
      });
    }

    return NextResponse.json({ date: tomorrow, notices });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/holidays/upcoming GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
