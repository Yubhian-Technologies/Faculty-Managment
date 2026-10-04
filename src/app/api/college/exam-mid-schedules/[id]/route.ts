export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { validateMidSchedule, type MidSchedulePayload } from "@/lib/exams/examMidSchedule";

// Every field is editable after publish - no locked fields, matching how
// exam-circulars' NOTICE kind is fully editable.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await readJsonBody(request)) as MidSchedulePayload;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("examMidSchedules").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const error = await validateMidSchedule(db, session.collegeId, body);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const updates = {
      courseId: body.courseId ?? null,
      courseName: body.courseName,
      semester: body.semester,
      totalSemesters: body.totalSemesters,
      midNumber: body.midNumber,
      fromDate: body.fromDate,
      toDate: body.toDate,
      fromTime: body.fromTime,
      toTime: body.toTime,
      updatedAt: new Date(),
    };
    await ref.update(updates);
    return NextResponse.json({ schedule: { id, ...snap.data(), ...updates } });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-mid-schedules/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const { id } = await params;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("examMidSchedules").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-mid-schedules/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
