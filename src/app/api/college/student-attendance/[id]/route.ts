export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { checkFacultyPeriodWindow, periodWindowMessage } from "@/lib/timetable/currentPeriod";
import { mergeMarkUpdates } from "@/lib/studentAttendance/onDuty";
import type { StudentAttendanceEntry, StudentAttendanceMark, StudentAttendanceSession } from "@/types";

const VALID_MARKS: StudentAttendanceMark[] = ["PRESENT", "ABSENT"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember("PANEL_MEMBER");
    const body = (await readJsonBody(request)) as {
      entries?: { studentId: string; status: StudentAttendanceMark | null }[];
      classNotes?: string;
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
    if (existing.facultyId !== session.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (existing.status === "SUBMITTED") {
      return NextResponse.json({ error: "Attendance has already been submitted and cannot be edited" }, { status: 409 });
    }

    // Version check — if client sent the updatedAt it last saw, enforce it
    // to avoid last-write-wins silent loss when two tabs/devices edit same DRAFT.
    if (body.expectedUpdatedAt) {
      const serverMs = (existing.updatedAt as unknown as { toDate?: () => Date })?.toDate?.()?.getTime?.() ?? 0;
      let clientMs: number = NaN;
      const exp: unknown = body.expectedUpdatedAt;
      if (typeof exp === "string") clientMs = new Date(exp).getTime();
      else if (exp && typeof exp === "object") {
        const o = exp as { _seconds?: number; seconds?: number; toDate?: () => Date };
        if (typeof o.toDate === "function") clientMs = o.toDate().getTime();
        else if (typeof o._seconds === "number") clientMs = o._seconds * 1000;
        else if (typeof o.seconds === "number") clientMs = o.seconds * 1000;
      }
      if (!Number.isNaN(clientMs) && serverMs !== 0 && clientMs !== serverMs) {
        return NextResponse.json(
          { error: "This attendance was updated elsewhere. Please reload and try again.", session: { ...existing, id } },
          { status: 409 }
        );
      }
    }

    // The published timetable is the source of truth for WHEN this can be
    // saved, not the client's clock or whatever the UI happened to show —
    // reject any save (mark changes or submit) once this exact faculty +
    // assignment has fallen outside its period window, even if the session
    // itself is still a DRAFT (e.g. a request replayed after the period
    // ended, or one crafted directly against an old/completed period).
    // `existing.periodNumber` is also passed through so that a still-DRAFT
    // Period 1 session can't be saved once Period 2 (same assignment) has
    // taken over - "some period of this assignment is active right now"
    // isn't enough; it must be THIS session's own period.
    const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, session.uid);
    const windowCheck = await checkFacultyPeriodWindow(
      db, session.collegeId, facultyMemberId, existing.assignmentId, existing.date, new Date(), existing.periodNumber
    );
    if (!windowCheck.ok) {
      return NextResponse.json({ error: periodWindowMessage(windowCheck) }, { status: 403 });
    }

    if (body.entries) {
      for (const e of body.entries) {
        if (e.status !== null && !VALID_MARKS.includes(e.status)) {
          return NextResponse.json({ error: "Attendance status must be PRESENT or ABSENT" }, { status: 400 });
        }
      }
    }
    const updates = body.entries ? new Map(body.entries.map((e) => [e.studentId, e.status])) : null;
    const now = new Date();

    // Read-merge-write inside a transaction: the merge is applied to the doc as
    // it is NOW, not to the copy read above, so two devices saving different
    // students' marks can't overwrite each other, and a submit that lands
    // between the read and the write can't be edited afterward.
    type TxResult = { error: { message: string; status: number } } | { merged: Record<string, unknown>; fresh: StudentAttendanceSession };
    const result: TxResult = await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(ref);
      if (!freshSnap.exists) return { error: { message: "Not found", status: 404 } };
      const fresh = freshSnap.data() as StudentAttendanceSession;
      if (fresh.status === "SUBMITTED") {
        return { error: { message: "Attendance has already been submitted and cannot be edited", status: 409 } };
      }

      // An ON_DUTY entry (a student officially away for this period) is locked: a
      // faculty member's save can neither change nor clear it. It is lifted only
      // when the permission behind it is withdrawn.
      const entries: StudentAttendanceEntry[] = updates ? mergeMarkUpdates(fresh.entries, updates as Map<string, "PRESENT" | "ABSENT" | null>) : fresh.entries;
      const presentCount = entries.filter((e) => e.status === "PRESENT").length;
      const markedCount = entries.filter((e) => e.status != null).length;

      const update: Record<string, unknown> = { entries, presentCount, updatedAt: now };
      if (body.classNotes !== undefined) update.classNotes = body.classNotes.trim();

      if (body.submit) {
        if (fresh.totalStudents > 0 && markedCount < fresh.totalStudents) {
          return { error: { message: "Please mark attendance for all students before submitting", status: 400 } };
        }
        const classNotes = ((update.classNotes as string | undefined) ?? fresh.classNotes ?? "").trim();
        if (!classNotes) {
          return { error: { message: "Record of the Class Work is required before submitting attendance", status: 400 } };
        }
        update.status = "SUBMITTED";
        update.submittedAt = now;
      }

      tx.update(ref, update);
      return { merged: update, fresh };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error.message }, { status: result.error.status });
    }
    const update = result.merged;
    Object.assign(existing, result.fresh);

    return NextResponse.json({ session: { ...existing, ...update, id } });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student-attendance/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
