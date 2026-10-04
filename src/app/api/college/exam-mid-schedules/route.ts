export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { validateMidSchedule, type MidSchedulePayload } from "@/lib/exams/examMidSchedule";

// Same broad read set as exam-configurations/exam-circulars.
const READ_ROLES = ["EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"];

export async function GET() {
  try {
    const session = await requireCollegeMember(...READ_ROLES);
    const db = getAdminDb();
    const snap = await db
      .collection("colleges").doc(session.collegeId).collection("examMidSchedules")
      .orderBy("fromDate", "asc")
      .get();
    const schedules = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ schedules });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-mid-schedules GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const body = (await readJsonBody(request)) as MidSchedulePayload;

    const db = getAdminDb();
    const error = await validateMidSchedule(db, session.collegeId, body);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Exam Cell";

    const now = new Date();
    const data = {
      collegeId: session.collegeId,
      ...(body.courseId ? { courseId: body.courseId } : {}),
      courseName: body.courseName,
      semester: body.semester,
      totalSemesters: body.totalSemesters,
      midNumber: body.midNumber,
      fromDate: body.fromDate,
      toDate: body.toDate,
      fromTime: body.fromTime,
      toTime: body.toTime,
      createdBy: session.uid,
      createdByName: actorName,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await db.collection("colleges").doc(session.collegeId).collection("examMidSchedules").add(data);
    return NextResponse.json({ schedule: { id: ref.id, ...data } }, { status: 201 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-mid-schedules POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
