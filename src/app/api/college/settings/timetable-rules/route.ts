export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { DEFAULT_TIMETABLE_RULES } from "@/types";
import type { DayOfWeek, TimetableRules } from "@/types";
import { FieldValue } from "firebase-admin/firestore";

// Per-college scheduling constraints at colleges/{id}/settings/timetableRules.
// Rules vary college to college, so the solver reads them rather than hard-coding
// anything. GET falls back to DEFAULT_TIMETABLE_RULES so the feature works before
// anyone has configured it.

const VALID_DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

export async function GET() {
  try {
    const session = await requireCollegeMember(
      "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "SUPER_ADMIN",
    );
    const db = getAdminDb();
    const snap = await db
      .collection("colleges").doc(session.collegeId)
      .collection("settings").doc("timetableRules")
      .get();

    if (!snap.exists) {
      return NextResponse.json({ rules: DEFAULT_TIMETABLE_RULES, isDefault: true });
    }

    // Merge over defaults so a doc written before a new rule was added still
    // returns a complete object.
    const rules = { ...DEFAULT_TIMETABLE_RULES, ...(snap.data() as Partial<TimetableRules>) };
    return NextResponse.json({ rules, isDefault: false });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/settings/timetable-rules GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as Partial<TimetableRules>;

    const days = Array.isArray(body.workingDays)
      ? VALID_DAYS.filter((d) => (body.workingDays as DayOfWeek[]).includes(d))
      : DEFAULT_TIMETABLE_RULES.workingDays;

    if (days.length === 0) {
      return NextResponse.json({ error: "At least one working day is required" }, { status: 400 });
    }

    // Clamped rather than rejected: these are dials, and an out-of-range value is
    // a slider mistake, not an attack. Bounds keep the solver's search tractable.
    const rules: TimetableRules = {
      workingDays: days,
      maxPeriodsPerFacultyPerDay: clampInt(body.maxPeriodsPerFacultyPerDay, 1, 12, DEFAULT_TIMETABLE_RULES.maxPeriodsPerFacultyPerDay),
      maxConsecutivePeriodsPerFaculty: clampInt(body.maxConsecutivePeriodsPerFaculty, 1, 12, DEFAULT_TIMETABLE_RULES.maxConsecutivePeriodsPerFaculty),
      maxPeriodsPerSubjectPerDay: clampInt(body.maxPeriodsPerSubjectPerDay, 1, 6, DEFAULT_TIMETABLE_RULES.maxPeriodsPerSubjectPerDay),
      labBlockSize: clampInt(body.labBlockSize, 1, 6, DEFAULT_TIMETABLE_RULES.labBlockSize),
      allowLabAcrossBreaks: Boolean(body.allowLabAcrossBreaks),
      preferTheoryInMorning: Boolean(body.preferTheoryInMorning),
      spreadSubjectsAcrossWeek: Boolean(body.spreadSubjectsAcrossWeek),
    };

    const db = getAdminDb();
    await db
      .collection("colleges").doc(session.collegeId)
      .collection("settings").doc("timetableRules")
      .set(
        { ...rules, updatedAt: FieldValue.serverTimestamp(), updatedByName: session.email },
        { merge: true },
      );

    return NextResponse.json({ rules });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/settings/timetable-rules PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
