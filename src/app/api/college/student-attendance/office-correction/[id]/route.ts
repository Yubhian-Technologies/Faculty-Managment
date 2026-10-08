export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodManageFacultyDepartment } from "@/lib/departments/scope";
import { isManualEditWindowOpen, MANUAL_EDIT_WINDOW_CLOSED_MESSAGE } from "@/lib/attendance/attendanceWindow";
import { getFacultyPeriodsForDate } from "@/lib/timetable/currentPeriod";
import {
  departmentOfficeBlocked, facultyWindowClosed, FACULTY_WINDOW_OPEN_MESSAGE, OFFICE_ATTENDANCE_DENIED_MESSAGE,
} from "@/lib/attendance/officeCorrectionAccess";
import { istDateFromParts } from "@/lib/attendance/istTime";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { mergeMarkUpdates } from "@/lib/studentAttendance/onDuty";
import { applyTallyDeltaInTx } from "@/lib/studentAttendance/dayTally";
import type { StudentAttendanceEntry, StudentAttendanceMark, StudentAttendanceSession } from "@/types";

const VALID_MARKS: StudentAttendanceMark[] = ["PRESENT", "ABSENT"];

// Companion to POST /api/college/student-attendance/office-correction - saves
// marks and (once every student is marked, same rule as the faculty-facing
// route) submits, locking the record exactly the same way a faculty's own
// submission does. Re-validates the department-office window on every save
// (same "re-check on every write, not just at creation" convention as
// checkFacultyPeriodWindow on the faculty side) so this can't be used to
// correct a record once its own month has closed.
//
// Deliberately does NOT require the DRAFT to have been created through the
// office-correction POST above - an HOD/office can also step in and finish a
// DRAFT the faculty started themselves but never submitted (same underlying
// problem: nothing got SUBMITTED). Either way, reaching this route to submit
// stamps postedBy/correctedBy* - the audit trail always reflects who actually
// finished the record, not just who created the draft row.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember("HOD");
    const body = (await readJsonBody(request)) as {
      entries?: { studentId: string; status: StudentAttendanceMark | null }[];
      classNotes?: string;
      reason?: string;
      submit?: boolean;
      expectedUpdatedAt?: string | null;
    };

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const ref = collegeRef.collection("studentAttendance").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const existing = snap.data() as StudentAttendanceSession;
    // A SUBMITTED record may be corrected here (HOD/dept office only); it stays
    // SUBMITTED and every save is audited with a mandatory reason.
    const wasSubmitted = existing.status === "SUBMITTED";

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodManageFacultyDepartment(scope, existing.department)) {
        return NextResponse.json({ error: "That faculty is not in your department" }, { status: 403 });
      }
      // A Department Office head holds the HOD's authority except here: the HOD must have switched this on.
      if (await departmentOfficeBlocked(db, session.collegeId, session, scope.ownDepartmentNames)) {
        return NextResponse.json({ error: OFFICE_ATTENDANCE_DENIED_MESSAGE }, { status: 403 });
      }
    }

    const [y, m, d] = existing.date.split("-").map(Number);
    const docDate = istDateFromParts(y, m, d);
    if (!isManualEditWindowOpen(docDate)) {
      return NextResponse.json({ error: MANUAL_EDIT_WINDOW_CLOSED_MESSAGE }, { status: 403 });
    }
    // Only once the faculty's own window is over: a past day, or today after the college day
    // ended. A session whose period is no longer on the timetable has no close time, so for
    // such a session only a past day qualifies.
    let closeTime: string | undefined;
    if (existing.periodNumber != null) {
      // existing.facultyId is the login uid (see office-correction/route.ts's
      // own comment), but getFacultyPeriodsForDate keys off the FacultyMember
      // doc id (same as timetableSlots/teachingAssignments) - without this
      // resolution the lookup always misses and the "period hasn't ended yet"
      // guard below silently never fires.
      const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, existing.facultyId);
      const periodsForDate = await getFacultyPeriodsForDate(db, session.collegeId, facultyMemberId, existing.date, undefined, { semesterOnDate: true });
      const matchedPeriod = periodsForDate.find(
        (p) => p.slot.assignmentId === existing.assignmentId && p.slot.periodNumber === existing.periodNumber
      );
      closeTime = matchedPeriod?.closeTime;
    }
    if (!facultyWindowClosed(existing.date, closeTime)) {
      return NextResponse.json({ error: FACULTY_WINDOW_OPEN_MESSAGE }, { status: 403 });
    }

    if (body.entries !== undefined && !Array.isArray(body.entries)) {
      return NextResponse.json({ error: "entries must be a list" }, { status: 400 });
    }
    if (body.classNotes !== undefined && typeof body.classNotes !== "string") {
      return NextResponse.json({ error: "classNotes must be text" }, { status: 400 });
    }
    const updates = body.entries ? new Map(body.entries.map((e) => [e.studentId, e.status])) : null;
    if (updates) {
      for (const status of updates.values()) {
        if (status !== null && !VALID_MARKS.includes(status)) {
          return NextResponse.json({ error: "Attendance status must be PRESENT or ABSENT" }, { status: 400 });
        }
      }
    }

    const now = new Date();
    const markerName = (body.submit || wasSubmitted)
      ? ((await collegeRef.collection("users").doc(session.uid).get()).data() as { name?: string } | undefined)?.name ?? ""
      : "";
    // Optional optimistic check: the updatedAt (ISO) the editor last loaded.
    const expectedMs = typeof body.expectedUpdatedAt === "string" ? new Date(body.expectedUpdatedAt).getTime() : NaN;

    // Read, merge, write, audit and tally delta in ONE transaction: the merge is applied to the
    // document as it is now (not the copy read above), and the audit entry exists only if the
    // change does.
    type TxResult = { error: { message: string; status: number } } | { update: Record<string, unknown>; fresh: StudentAttendanceSession };
    const result: TxResult = await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(ref);
      if (!freshSnap.exists) return { error: { message: "Not found", status: 404 } };
      const fresh = freshSnap.data() as StudentAttendanceSession;
      const serverMs = (fresh.updatedAt as unknown as { toDate?: () => Date })?.toDate?.()?.getTime?.() ?? 0;
      if (!Number.isNaN(expectedMs) && serverMs !== 0 && expectedMs !== serverMs) {
        return { error: { message: "This attendance was updated elsewhere. Please reload and try again.", status: 409 } };
      }
      const freshSubmitted = fresh.status === "SUBMITTED";
      // ON_DUTY is locked here too: the Office can correct a mark, but not
      // override an approved permission.
      const entries: StudentAttendanceEntry[] = updates ? mergeMarkUpdates(fresh.entries, updates as Map<string, "PRESENT" | "ABSENT" | null>) : fresh.entries;
      const presentCount = entries.filter((e) => e.status === "PRESENT").length;
      const markedCount = entries.filter((e) => e.status != null).length;

      const update: Record<string, unknown> = { entries, presentCount, updatedAt: now };
      if (body.classNotes !== undefined) update.classNotes = body.classNotes.trim();

      if (body.submit || freshSubmitted) {
        if (markedCount < fresh.totalStudents || fresh.totalStudents === 0) {
          return { error: { message: "Please mark attendance for all students before submitting", status: 400 } };
        }
        const classNotes = ((update.classNotes as string | undefined) ?? fresh.classNotes ?? "").trim();
        if (!classNotes) {
          return { error: { message: "Record of the Class Work is required before submitting attendance", status: 400 } };
        }
        const reason = body.reason?.trim() || fresh.correctionReason;
        if (!reason) {
          return { error: { message: "A reason is required to post attendance on a faculty member's behalf", status: 400 } };
        }
        update.status = "SUBMITTED";
        // A corrected record keeps the faculty's original submission time/attribution.
        if (!freshSubmitted) {
          update.submittedAt = now;
          update.postedBy = "OFFICE";
        }
        update.correctedByUid = session.uid;
        update.correctedByName = markerName;
        update.correctionReason = reason;

        const before = new Map(fresh.entries.map((e) => [e.studentId, e.status]));
        const changes = entries
          .filter((e) => before.get(e.studentId) !== e.status)
          .slice(0, 200)
          .map((e) => ({ studentId: e.studentId, from: before.get(e.studentId) ?? null, to: e.status }));
        tx.set(collegeRef.collection("auditLogs").doc(), {
          collegeId: session.collegeId,
          action: "STUDENT_ATTENDANCE_OFFICE_CORRECTED",
          performedBy: session.uid,
          performedByName: markerName,
          targetId: id,
          details: { facultyId: fresh.facultyId, facultyName: fresh.facultyName, date: fresh.date, periodNumber: fresh.periodNumber, subjectName: fresh.subjectName, reason, previouslySubmitted: freshSubmitted, changes },
          timestamp: now,
        });
      }

      tx.update(ref, update);
      // Counts the change against the document as it is NOW (no-op when the tally is off).
      applyTallyDeltaInTx(tx, db, session.collegeId, fresh, { ...fresh, ...update, entries } as StudentAttendanceSession);
      return { update, fresh };
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error.message }, { status: result.error.status });
    }
    return NextResponse.json({ session: { ...result.fresh, ...result.update, id } });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student-attendance/office-correction/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
