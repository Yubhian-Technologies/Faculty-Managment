export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { closeMissedCheckouts, toAttendanceDate } from "@/lib/attendance/closeMissedCheckouts";
import { isSunday } from "@/lib/attendance/attendanceWindow";
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
  // AttendanceStatus, or a synthetic value for "no record exists yet for the
  // day": "NOT_REGISTERED" (never registered their face at all - takes
  // priority) or "NOT_MARKED" (registered, hasn't checked in *today* yet -
  // still in progress, not judged). A past day with no record derives to
  // ABSENT (or HOLIDAY on a Sunday) once it's on/after that person's
  // face-registration date - before that date, or before today's window
  // closes, it stays NOT_MARKED/NOT_REGISTERED. Approved leave and the
  // office Holidays calendar still aren't cross-referenced here.
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  checkInVerified: boolean;
  checkOutVerified: boolean;
  registered: boolean;
  // The reason an HOD/Principal/VP wrote when manually marking/correcting
  // this record (see /api/college/attendance/manual), or the auto-generated
  // explanation when a day gets corrected/derived to Absent - so anyone
  // reviewing this roster (including Management, viewing the same data
  // elsewhere) can see why, not just what.
  remarks: string | null;
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

    // Faculty's face-registration status lives on their facultyMembers doc
    // (see resolveOwnDocRef in the face-registration API) - fetched
    // unconditionally (scoped like everything else) since both HOD's and the
    // college-wide report need it now, not just the course-grouping below.
    let facultyMembersQuery: FirebaseFirestore.Query = collegeRef.collection("facultyMembers");
    if (scopeDepartments) facultyMembersQuery = facultyMembersQuery.where("department", "in", scopeDepartments);
    const facultyMembersSnap = await facultyMembersQuery.get();
    const uidToFacultyMemberId = new Map<string, string>();
    const uidToRegistered = new Map<string, boolean>();
    const uidToRegisteredAt = new Map<string, Date | null>();
    for (const doc of facultyMembersSnap.docs) {
      const fm = doc.data() as { userUid?: string; faceEmbedding?: number[]; faceRegisteredAt?: FirebaseFirestore.Timestamp };
      if (!fm.userUid) continue;
      uidToFacultyMemberId.set(fm.userUid, doc.id);
      uidToRegistered.set(fm.userUid, Array.isArray(fm.faceEmbedding) && fm.faceEmbedding.length > 0);
      uidToRegisteredAt.set(fm.userUid, fm.faceRegisteredAt ? fm.faceRegisteredAt.toDate() : null);
    }

    const usersSnap = await usersQuery.get();
    const roster: RosterEntry[] = usersSnap.docs.map((d) => {
      const u = d.data() as { name?: string; department?: string };
      return {
        uid: d.id, name: u.name ?? "", department: u.department ?? "", role: "PANEL_MEMBER" as const,
        status: "NOT_MARKED", checkIn: null, checkOut: null, checkInVerified: false, checkOutVerified: false,
        registered: uidToRegistered.get(d.id) ?? false, remarks: null,
      };
    });

    // College-wide (Principal/VP/Super Admin) callers also need each
    // department's HOD in the roster — the Principal's report shows the HOD
    // alongside their department's faculty. HOD's own department view stays
    // Faculty-only, unchanged. HOD registers directly on their own
    // users/{uid} doc (no facultyMembers record), so no lookup needed here.
    if (session.role !== "HOD") {
      const hodsSnap = await collegeRef.collection("users").where("role", "==", "HOD").get();
      for (const d of hodsSnap.docs) {
        const u = d.data() as { name?: string; department?: string; faceEmbedding?: number[]; faceRegisteredAt?: FirebaseFirestore.Timestamp };
        roster.push({
          uid: d.id, name: u.name ?? "", department: u.department ?? "", role: "HOD" as const,
          status: "NOT_MARKED", checkIn: null, checkOut: null, checkInVerified: false, checkOutVerified: false,
          registered: Array.isArray(u.faceEmbedding) && u.faceEmbedding.length > 0, remarks: null,
        });
        uidToRegisteredAt.set(d.id, u.faceRegisteredAt ? u.faceRegisteredAt.toDate() : null);
      }
    }

    if (roster.length === 0) {
      return NextResponse.json({ date: docSuffix, roster: [] });
    }

    const rosterByUid = new Map(roster.map((r) => [r.uid, r]));
    let recordsQuery: FirebaseFirestore.Query = collegeRef.collection("attendanceRecords");
    if (scopeDepartments) recordsQuery = recordsQuery.where("department", "in", scopeDepartments);
    const recordsSnap = await recordsQuery.get();

    // Two passes: first collect this date's matching records (with a ref, so
    // closeMissedCheckouts can persist any correction), then apply the
    // (possibly corrected) status onto the roster - so a past date with a
    // missed checkout shows Absent here too, not a stale Present.
    const pending: {
      ref: FirebaseFirestore.DocumentReference;
      resolvedDate: Date | null;
      status: string;
      checkIn: string | null;
      checkOut: string | null;
      remarks: string | null;
      checkInVerified: boolean;
      checkOutVerified: boolean;
      entry: RosterEntry;
    }[] = [];

    for (const doc of recordsSnap.docs) {
      const rec = doc.data() as AttendanceRecord;
      if (!rosterByUid.has(rec.facultyId)) continue;
      const d = toAttendanceDate(rec.date);
      if (!d || d < start || d >= end) continue;
      pending.push({
        ref: doc.ref,
        resolvedDate: d,
        status: rec.status,
        checkIn: rec.checkIn ?? null,
        checkOut: rec.checkOut ?? null,
        remarks: rec.remarks ?? null,
        checkInVerified: !!rec.checkInVerified,
        checkOutVerified: !!rec.checkOutVerified,
        entry: rosterByUid.get(rec.facultyId)!,
      });
    }

    await closeMissedCheckouts(db, pending);

    for (const p of pending) {
      p.entry.status = p.status;
      p.entry.checkIn = p.checkIn;
      p.entry.checkOut = p.checkOut;
      p.entry.checkInVerified = p.checkInVerified;
      p.entry.checkOutVerified = p.checkOutVerified;
      p.entry.remarks = p.remarks;
    }

    // "No record yet" defaults to NOT_MARKED above - refine it:
    //   - Never registered at all -> NOT_REGISTERED (most actionable).
    //   - A past date, on/after their registration date -> ABSENT (or
    //     HOLIDAY if that date is a Sunday) - they could have checked in
    //     and didn't. Before registration, or today, stays NOT_MARKED.
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (const entry of roster) {
      if (entry.status !== "NOT_MARKED") continue;
      if (!entry.registered) {
        entry.status = "NOT_REGISTERED";
        continue;
      }
      const registeredAt = uidToRegisteredAt.get(entry.uid) ?? null;
      const regStart = registeredAt ? new Date(registeredAt.getFullYear(), registeredAt.getMonth(), registeredAt.getDate()) : null;
      if (start < todayStart && regStart && start >= regStart) {
        const holiday = isSunday(start);
        entry.status = holiday ? "HOLIDAY" : "ABSENT";
        if (!holiday) entry.remarks = "No check-in recorded";
      }
    }

    // Course grouping is only used by the college-wide (Principal/VP/Super
    // Admin) report — skip the extra reads for HOD's department view.
    if (session.role !== "HOD") {
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
