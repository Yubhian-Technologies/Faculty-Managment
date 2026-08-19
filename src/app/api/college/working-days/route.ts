export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { academicSessionLabel } from "@/lib/college/academicSession";
import { WORKING_DAY_ELIGIBLE_ROLES } from "@/lib/attendance/workingDays";
import type { UserRole, WorkingDayOverride } from "@/types";

// April cutoff, same convention as college/holidays/route.ts's own
// academicYearForDate.
function academicYearForDate(date: Date): string {
  const startYear = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return academicSessionLabel(startYear);
}

// Working Day overrides - flips a normally-off Sunday into a working day for
// specific roles (see types/attendance.ts's WorkingDayOverride and
// lib/attendance/workingDays.ts). Maintained in the same Settings screen as
// Holidays (college-office/holidays/page.tsx), same role gating as that
// collection: read open to every role that marks attendance or applies for
// leave, write restricted to Office/Principal/VP.
export async function GET() {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const db = getAdminDb();
    const snap = await db
      .collection("colleges").doc(session.collegeId).collection("workingDays")
      .orderBy("date", "asc")
      .get();
    const workingDays = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WorkingDayOverride);
    return NextResponse.json({ workingDays });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/working-days GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE");
    const body = (await request.json()) as {
      date?: string; reason?: string; roles?: UserRole[];
      isHalfDay?: boolean; halfDaySession?: "FN" | "AN";
    };

    if (!body.date || !body.reason?.trim() || !body.roles?.length) {
      return NextResponse.json({ error: "date, reason and at least one role are required" }, { status: 400 });
    }
    if (body.roles.some((r) => !WORKING_DAY_ELIGIBLE_ROLES.includes(r))) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (body.isHalfDay && body.halfDaySession !== "FN" && body.halfDaySession !== "AN") {
      return NextResponse.json({ error: "Select forenoon or afternoon for a half day" }, { status: 400 });
    }
    const date = new Date(body.date);
    if (Number.isNaN(date.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();
    const docRef = db.collection("colleges").doc(session.collegeId).collection("workingDays").doc();
    await docRef.set({
      collegeId: session.collegeId,
      date,
      reason: body.reason.trim(),
      roles: body.roles,
      isHalfDay: body.isHalfDay || false,
      ...(body.isHalfDay ? { halfDaySession: body.halfDaySession } : {}),
      academicYear: academicYearForDate(date),
      createdAt: now,
    });

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/working-days POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
