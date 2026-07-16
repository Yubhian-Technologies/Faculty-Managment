export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { DayOfWeek } from "@/types";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "VICE_PRINCIPAL");
    const { searchParams } = new URL(request.url);
    const sectionId = searchParams.get("sectionId");
    if (!sectionId) {
      return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("timetableSlots")
      .where("sectionId", "==", sectionId)
      .get();
    const slots = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ slots });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable-slots GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      assignmentId: string;
      day: DayOfWeek;
      periodNumber: number;
      classroom?: string;
    };

    const { assignmentId, day, periodNumber } = body;
    if (!assignmentId || !day || !periodNumber) {
      return NextResponse.json({ error: "assignmentId, day and periodNumber are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const assignmentSnap = await collegeRef.collection("teachingAssignments").doc(assignmentId).get();
    if (!assignmentSnap.exists) return NextResponse.json({ error: "Teaching assignment not found" }, { status: 404 });
    const assignment = assignmentSnap.data() as {
      facultyId: string; facultyName: string; courseId: string; year: number;
      sectionId: string; subjectId: string; subjectName: string; department: string;
    };

    const conflict = await collegeRef.collection("timetableSlots")
      .where("sectionId", "==", assignment.sectionId)
      .where("day", "==", day)
      .where("periodNumber", "==", Number(periodNumber))
      .limit(1)
      .get();
    if (!conflict.empty) {
      return NextResponse.json(
        { error: `Conflict: this section already has a subject scheduled on ${day} period ${periodNumber}` },
        { status: 409 }
      );
    }

    const now = new Date();
    const ref = await collegeRef.collection("timetableSlots").add({
      collegeId: session.collegeId,
      department: assignment.department,
      assignmentId,
      facultyId: assignment.facultyId,
      facultyName: assignment.facultyName,
      courseId: assignment.courseId,
      year: assignment.year,
      sectionId: assignment.sectionId,
      subjectId: assignment.subjectId,
      subjectName: assignment.subjectName,
      day,
      periodNumber: Number(periodNumber),
      classroom: body.classroom ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable-slots POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
