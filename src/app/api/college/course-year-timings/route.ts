export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { BreakConfig } from "@/types";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE", "ACCOUNTS", "PANEL_MEMBER");
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");

    const db = getAdminDb();
    let query = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("courseYearTimings") as FirebaseFirestore.Query;

    if (courseId) query = query.where("courseId", "==", courseId);

    const snap = await query.get();
    const timings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ timings });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/course-year-timings GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Upsert — one doc per (courseId, year)
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      departmentId: string;
      courseId: string;
      year: number;
      collegeStartTime: string;
      collegeEndTime: string;
      numberOfPeriods: number;
      periodDurationMinutes: number;
      lunchBreak: BreakConfig;
      shortBreaks: BreakConfig[];
    };

    const {
      departmentId, courseId, year, collegeStartTime, collegeEndTime,
      numberOfPeriods, periodDurationMinutes, lunchBreak, shortBreaks,
    } = body;

    if (!departmentId || !courseId || !year || !collegeStartTime || !collegeEndTime || !numberOfPeriods || !periodDurationMinutes) {
      return NextResponse.json({ error: "Missing required timing fields" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();
    const docId = `${courseId}_year${year}`;
    const ref = db.collection("colleges").doc(session.collegeId).collection("courseYearTimings").doc(docId);
    const existing = await ref.get();

    await ref.set({
      collegeId: session.collegeId,
      departmentId,
      courseId,
      year: Number(year),
      collegeStartTime,
      collegeEndTime,
      numberOfPeriods: Number(numberOfPeriods),
      periodDurationMinutes: Number(periodDurationMinutes),
      lunchBreak: lunchBreak ?? null,
      shortBreaks: shortBreaks ?? [],
      updatedAt: now,
      ...(existing.exists ? {} : { createdAt: now }),
    }, { merge: true });

    return NextResponse.json({ id: docId }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/course-year-timings POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
