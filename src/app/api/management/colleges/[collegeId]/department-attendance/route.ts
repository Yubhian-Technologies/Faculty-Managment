export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { AttendanceRecord } from "@/types";

interface RosterEntry {
  uid: string;
  name: string;
  role: "PANEL_MEMBER" | "HOD";
  // Course id(s) this faculty has an explicit teaching assignment under,
  // matched by courseId (not the free-text courseName - see
  // /api/college/attendance/report for why). Empty when not yet
  // disambiguated - the caller includes them under any course rather than
  // hiding a real department member, same rule as the Principal's own
  // Attendance Report page uses.
  courseIds?: string[];
  status: string; // AttendanceStatus, or "NOT_MARKED" when no record exists yet for the day
  checkIn: string | null;
  checkOut: string | null;
  checkInVerified: boolean;
  checkOutVerified: boolean;
}

function parseDateParam(dateParam: string | null): { start: Date; end: Date; docSuffix: string } {
  const d = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  const docSuffix = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  return { start, end, docSuffix };
}

// MANAGEMENT is read-only - this route only implements GET.
// Same attendanceRecords/teachingAssignments/facultyMembers cross-reference
// and courseId-matching rule as /api/college/attendance/report (session-
// scoped, unreachable by Management), just resolved by an explicit collegeId
// + department name param, and restricted to that one department (HOD +
// Faculty only) instead of the whole college.
export async function GET(request: Request, { params }: { params: Promise<{ collegeId: string }> }) {
  try {
    await requireManagement();
    const { collegeId } = await params;
    const { searchParams } = new URL(request.url);
    const department = searchParams.get("department");
    if (!department) {
      return NextResponse.json({ error: "department is required" }, { status: 400 });
    }
    const { start, end, docSuffix } = parseDateParam(searchParams.get("date"));

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(collegeId);

    const usersSnap = await collegeRef.collection("users")
      .where("department", "==", department)
      .where("role", "in", ["PANEL_MEMBER", "HOD"])
      .get();

    const roster: RosterEntry[] = usersSnap.docs.map((d) => {
      const u = d.data() as { name?: string; role?: string };
      const role: "PANEL_MEMBER" | "HOD" = u.role === "HOD" ? "HOD" : "PANEL_MEMBER";
      return {
        uid: d.id, name: u.name ?? "", role,
        status: "NOT_MARKED", checkIn: null, checkOut: null, checkInVerified: false, checkOutVerified: false,
      };
    });

    if (roster.length > 0) {
      const rosterByUid = new Map(roster.map((r) => [r.uid, r]));
      const recordsSnap = await collegeRef.collection("attendanceRecords")
        .where("department", "==", department)
        .get();

      for (const doc of recordsSnap.docs) {
        const rec = doc.data() as AttendanceRecord;
        if (!rosterByUid.has(rec.facultyId)) continue;
        const d = rec.date && typeof (rec.date as unknown as { toDate?: () => Date }).toDate === "function"
          ? (rec.date as unknown as { toDate: () => Date }).toDate()
          : new Date(rec.date as unknown as string);
        if (d < start || d >= end) continue;
        const entry = rosterByUid.get(rec.facultyId)!;
        entry.status = rec.status;
        entry.checkIn = rec.checkIn ?? null;
        entry.checkOut = rec.checkOut ?? null;
        entry.checkInVerified = !!rec.checkInVerified;
        entry.checkOutVerified = !!rec.checkOutVerified;
      }

      const facultyMembersSnap = await collegeRef.collection("facultyMembers").where("department", "==", department).get();
      const uidToFacultyMemberId = new Map<string, string>();
      for (const doc of facultyMembersSnap.docs) {
        const fm = doc.data() as { userUid?: string };
        if (fm.userUid) uidToFacultyMemberId.set(fm.userUid, doc.id);
      }

      const teachingSnap = await collegeRef.collection("teachingAssignments").where("department", "==", department).get();
      const facultyMemberIdToCourseIds = new Map<string, Set<string>>();
      for (const doc of teachingSnap.docs) {
        const ta = doc.data() as { facultyId?: string; courseId?: string };
        if (!ta.facultyId || !ta.courseId) continue;
        if (!facultyMemberIdToCourseIds.has(ta.facultyId)) facultyMemberIdToCourseIds.set(ta.facultyId, new Set());
        facultyMemberIdToCourseIds.get(ta.facultyId)!.add(ta.courseId);
      }

      for (const entry of roster) {
        const facultyMemberId = uidToFacultyMemberId.get(entry.uid);
        const courseIds = facultyMemberId ? facultyMemberIdToCourseIds.get(facultyMemberId) : undefined;
        entry.courseIds = courseIds ? Array.from(courseIds).sort() : [];
      }
    }

    roster.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ date: docSuffix, roster });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/colleges/department-attendance GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
