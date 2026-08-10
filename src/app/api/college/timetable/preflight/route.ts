export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadTimetableContext, pinnedCells } from "@/lib/timetable/loadContext";
import { preflight } from "@/lib/timetable/preflight";

// Readiness report for one section: are all the conditions for generation met?
// Drives the Generate button's enabled state and lists exactly what to fix.

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "SUPER_ADMIN",
    );
    const { searchParams } = new URL(request.url);
    const sectionId = searchParams.get("sectionId");
    if (!sectionId) {
      return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const ctx = await loadTimetableContext(db, session.collegeId, sectionId);
    if (!ctx) return NextResponse.json({ error: "Section not found" }, { status: 404 });

    const result = preflight({
      timing: ctx.timing,
      rules: ctx.rules,
      assignments: ctx.assignments,
      courseYearSubjects: ctx.courseYearSubjects,
      subjectsById: ctx.subjectsById,
      pinnedCellCount: pinnedCells(ctx.pinnedSlots).size,
    });

    return NextResponse.json({
      ...result,
      pinnedCount: ctx.pinnedSlots.length,
      rules: ctx.rules,
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable/preflight GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
