export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import type { AttendanceRecord } from "@/types";

interface RosterEntry {
  uid: string;
  name: string;
  department: string;
  role: "PANEL_MEMBER" | "HOD";
  // Course id(s) (Course.id in the `courses` collection) this faculty has an
  // explicit teaching assignment under, derived from teachingAssignments and
  // matched by courseId — teachingAssignments also carries a free-text
  // courseName, but that's a denormalized copy that isn't guaranteed to match
  // the course's actual current name (seen in real data: an assignment's
  // courseName of "BACHELOR OF TECHNOLOGY" for a course whose actual name is
  // "Bachelors of Technology" — courseId is the reliable foreign key). Only
  // populated for college-wide (non-HOD) callers, since only the Principal's
  // report filters by it. Empty when the faculty has no course-linked
  // teaching assignment on record — the Principal's report treats that as
  // "not yet disambiguated" rather than "belongs to no course".
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

// Daily oversight roster: every PANEL_MEMBER in scope (HOD: own department +
// sub-departments; Principal/VP/Super Admin: whole college), cross-referenced
// against that day's attendanceRecords so faculty who haven't checked in yet
// show up as "NOT_MARKED" instead of silently disappearing.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const { start, end, docSuffix } = parseDateParam(searchParams.get("date"));

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    let usersQuery: FirebaseFirestore.Query = collegeRef.collection("users").where("role", "==", "PANEL_MEMBER");
    let scopeDepartments: string[] | null = null;
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      scopeDepartments = [scope.departmentName, ...scope.childDepartmentNames].filter(Boolean).slice(0, 30);
      if (scopeDepartments.length === 0) {
        return NextResponse.json({ date: docSuffix, roster: [] });
      }
      usersQuery = usersQuery.where("department", "in", scopeDepartments);
    }

    const usersSnap = await usersQuery.get();
    const roster: RosterEntry[] = usersSnap.docs.map((d) => {
      const u = d.data() as { name?: string; department?: string };
      return {
        uid: d.id, name: u.name ?? "", department: u.department ?? "", role: "PANEL_MEMBER" as const,
        status: "NOT_MARKED", checkIn: null, checkOut: null, checkInVerified: false, checkOutVerified: false,
      };
    });

    // College-wide (Principal/VP/Super Admin) callers also need each
    // department's HOD in the roster — the Principal's report shows the HOD
    // alongside their department's faculty. HOD's own department view stays
    // Faculty-only, unchanged.
    if (session.role !== "HOD") {
      const hodsSnap = await collegeRef.collection("users").where("role", "==", "HOD").get();
      for (const d of hodsSnap.docs) {
        const u = d.data() as { name?: string; department?: string };
        roster.push({
          uid: d.id, name: u.name ?? "", department: u.department ?? "", role: "HOD" as const,
          status: "NOT_MARKED", checkIn: null, checkOut: null, checkInVerified: false, checkOutVerified: false,
        });
      }
    }

    if (roster.length === 0) {
      return NextResponse.json({ date: docSuffix, roster: [] });
    }

    const rosterByUid = new Map(roster.map((r) => [r.uid, r]));
    let recordsQuery: FirebaseFirestore.Query = collegeRef.collection("attendanceRecords");
    if (scopeDepartments) recordsQuery = recordsQuery.where("department", "in", scopeDepartments);
    const recordsSnap = await recordsQuery.get();

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

    // Course grouping is only used by the college-wide (Principal/VP/Super
    // Admin) report — skip the extra reads for HOD's department view.
    if (session.role !== "HOD") {
      const facultyMembersSnap = await collegeRef.collection("facultyMembers").get();
      const uidToFacultyMemberId = new Map<string, string>();
      for (const doc of facultyMembersSnap.docs) {
        const fm = doc.data() as { userUid?: string };
        if (fm.userUid) uidToFacultyMemberId.set(fm.userUid, doc.id);
      }

      const teachingSnap = await collegeRef.collection("teachingAssignments").get();
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
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance/report GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
