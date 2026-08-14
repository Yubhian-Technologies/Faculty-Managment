export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { closeMissedCheckouts, toAttendanceDate } from "@/lib/attendance/closeMissedCheckouts";
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
  // AttendanceStatus, or a synthetic value for "no record exists yet for the
  // day": "NOT_REGISTERED" (hasn't registered their face at all - takes
  // priority) or "NOT_MARKED" (registered, just hasn't checked in yet today).
  // Deliberately NOT "ABSENT" for a past day with no record - see
  // /api/college/attendance/report for why that derivation is deferred.
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  checkInVerified: boolean;
  checkOutVerified: boolean;
  registered: boolean;
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
      const u = d.data() as { name?: string; role?: string; faceEmbedding?: number[] };
      const role: "PANEL_MEMBER" | "HOD" = u.role === "HOD" ? "HOD" : "PANEL_MEMBER";
      return {
        uid: d.id, name: u.name ?? "", role,
        status: "NOT_MARKED", checkIn: null, checkOut: null, checkInVerified: false, checkOutVerified: false,
        // HOD registers directly on this same users/{uid} doc; PANEL_MEMBER
        // registers on their facultyMembers doc instead (filled in below).
        registered: role === "HOD" ? Array.isArray(u.faceEmbedding) && u.faceEmbedding.length > 0 : false,
      };
    });

    if (roster.length > 0) {
      const rosterByUid = new Map(roster.map((r) => [r.uid, r]));
      const recordsSnap = await collegeRef.collection("attendanceRecords")
        .where("department", "==", department)
        .get();

      // Two passes: first collect this date's matching records (with a ref,
      // so closeMissedCheckouts can persist any correction), then apply the
      // (possibly corrected) status onto the roster.
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
      }

      const facultyMembersSnap = await collegeRef.collection("facultyMembers").where("department", "==", department).get();
      const uidToFacultyMemberId = new Map<string, string>();
      for (const doc of facultyMembersSnap.docs) {
        const fm = doc.data() as { userUid?: string; faceEmbedding?: number[] };
        if (!fm.userUid) continue;
        uidToFacultyMemberId.set(fm.userUid, doc.id);
        if (rosterByUid.get(fm.userUid)?.role === "PANEL_MEMBER") {
          rosterByUid.get(fm.userUid)!.registered = Array.isArray(fm.faceEmbedding) && fm.faceEmbedding.length > 0;
        }
      }

      // "No record yet" defaults to NOT_MARKED above - promote it to
      // NOT_REGISTERED when the person hasn't registered their face at all.
      for (const entry of roster) {
        if (entry.status === "NOT_MARKED" && !entry.registered) {
          entry.status = "NOT_REGISTERED";
        }
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
