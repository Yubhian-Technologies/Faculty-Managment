export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { getHolidayDateKeys } from "@/lib/leave/holidaysCount";
import { buildPeriodCoverage } from "@/lib/leave/periodCoverage";
import {
  isAdjustmentManager, listAdjustableSubjects, listCoverCandidates, resolveManagerDepartments,
} from "@/lib/leave/staffAdjustmentScope";
import type { FacultyMember } from "@/types";

// Feeds the Adjustments form (see components/leave/StaffAdjustmentsPage).
//  - no params: the people this manager may adjust (their own tier below them);
//  - subjectUid + fromDate + toDate: that person's timetabled periods in the
//    range with who's genuinely free to take each, plus who can cover their
//    other duties - everyone on leave / already tied up is left out.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "COLLEGE_OFFICE");
    if (!isAdjustmentManager(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const manager = { uid: session.uid, role: session.role };
    const db = getAdminDb();

    const url = new URL(request.url);
    const subjectUid = url.searchParams.get("subjectUid");
    const subjects = await listAdjustableSubjects(db, session.collegeId, manager);
    if (!subjectUid) return NextResponse.json({ subjects });

    const subject = subjects.find((s) => s.uid === subjectUid);
    if (!subject) return NextResponse.json({ error: "That person isn't one you can adjust" }, { status: 403 });

    const fromISO = url.searchParams.get("fromDate");
    const toISO = url.searchParams.get("toDate");
    if (!fromISO || !toISO || toISO < fromISO) {
      return NextResponse.json({ error: "A valid fromDate and toDate are required" }, { status: 400 });
    }
    const fromDate = new Date(fromISO);
    const toDate = new Date(toISO);

    const departments = await resolveManagerDepartments(db, session.collegeId, manager);
    const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, subject.uid);
    const holidayDates = await getHolidayDateKeys(db, session.collegeId, fromDate, toDate);
    const [periods, coverCandidates] = await Promise.all([
      buildPeriodCoverage(
        db, session.collegeId, facultyMemberId, subject.department, fromDate, toDate, holidayDates,
        { candidateFilter: departments ? (f: FacultyMember) => departments.includes(f.department ?? "") : undefined }
      ),
      listCoverCandidates(db, session.collegeId, manager, subject, { fromISO, toISO }),
    ]);

    return NextResponse.json({ subject, periods, coverCandidates });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/staff-adjustments/options GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
