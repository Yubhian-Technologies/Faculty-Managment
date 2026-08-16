export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { StudentAttendanceEntry, StudentAttendanceMark, StudentAttendanceSession } from "@/types";

const VALID_MARKS: StudentAttendanceMark[] = ["PRESENT", "ABSENT"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember("PANEL_MEMBER");
    const body = (await request.json()) as {
      entries?: { studentId: string; status: StudentAttendanceMark | null }[];
      classNotes?: string;
      submit?: boolean;
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

    let entries: StudentAttendanceEntry[] = existing.entries;
    if (body.entries) {
      const updates = new Map(body.entries.map((e) => [e.studentId, e.status]));
      for (const status of updates.values()) {
        if (status !== null && !VALID_MARKS.includes(status)) {
          return NextResponse.json({ error: "Attendance status must be PRESENT or ABSENT" }, { status: 400 });
        }
      }
      entries = existing.entries.map((e) => {
        if (!updates.has(e.studentId)) return e;
        return { ...e, status: updates.get(e.studentId) ?? null };
      });
    }
    const presentCount = entries.filter((e) => e.status === "PRESENT").length;
    const markedCount = entries.filter((e) => e.status != null).length;

    const now = new Date();
    const update: Record<string, unknown> = { entries, presentCount, updatedAt: now };
    if (body.classNotes !== undefined) {
      update.classNotes = body.classNotes.trim();
    }

    if (body.submit) {
      if (markedCount < existing.totalStudents || existing.totalStudents === 0) {
        return NextResponse.json(
          { error: "Please mark attendance for all students before submitting" },
          { status: 400 }
        );
      }
      update.status = "SUBMITTED";
      update.submittedAt = now;
    }

    await ref.update(update);

    return NextResponse.json({ session: { ...existing, ...update, id } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student-attendance/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
