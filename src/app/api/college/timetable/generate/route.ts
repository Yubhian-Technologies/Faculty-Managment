export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadTimetableContext, pinnedCells } from "@/lib/timetable/loadContext";
import { preflight } from "@/lib/timetable/preflight";
import { buildDemands } from "@/lib/timetable/buildDemands";
import { solve } from "@/lib/timetable/solve";
import { FieldValue } from "firebase-admin/firestore";
import type { TimetableDraft } from "@/types";

// Runs preflight, then the solver, and stores the result as a DRAFT.
//
// This route never writes to `timetableSlots`. The Class Leader route and the
// faculty teaching view read that collection with no published filter, so a
// draft written there would be visible to students the instant it was generated.
// Only /api/college/timetable/publish materialises a draft.

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as { sectionId?: string };
    const sectionId = body.sectionId;
    if (!sectionId) {
      return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const ctx = await loadTimetableContext(db, session.collegeId, sectionId);
    if (!ctx) return NextResponse.json({ error: "Section not found" }, { status: 404 });

    const pinned = pinnedCells(ctx.pinnedSlots);

    const check = preflight({
      timing: ctx.timing,
      rules: ctx.rules,
      assignments: ctx.assignments,
      courseYearSubjects: ctx.courseYearSubjects,
      subjectsById: ctx.subjectsById,
      pinnedCellCount: pinned.size,
    });

    if (!check.ready || !ctx.timing) {
      return NextResponse.json(
        {
          error: "Not ready to generate",
          issues: check.issues.filter((i) => i.severity === "error").map((i) => i.message),
        },
        { status: 409 },
      );
    }

    const active = ctx.assignments.filter((a) => !a.isPast);
    const { demands } = buildDemands(active, ctx.subjectsById, ctx.rules);

    const result = solve({
      timing: ctx.timing,
      rules: ctx.rules,
      demands,
      pinnedCells: pinned,
      busyFaculty: ctx.busyFaculty,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: "Could not generate a valid timetable", issues: result.diagnostics },
        { status: 422 },
      );
    }

    // Warnings from preflight are worth keeping alongside the draft so the HOD
    // sees them at review time, not only at generate time.
    const diagnostics = [
      ...check.issues.filter((i) => i.severity === "warning").map((i) => i.message),
      ...result.diagnostics,
    ];

    const draft: Omit<TimetableDraft, "id" | "generatedAt"> & { generatedAt: FieldValue } = {
      collegeId: session.collegeId,
      department: ctx.section.department,
      courseId: ctx.section.courseId,
      year: Number(ctx.section.year),
      sectionId,
      sectionName: ctx.section.name,
      status: "DRAFT",
      slots: result.slots,
      diagnostics,
      generatedAt: FieldValue.serverTimestamp(),
      generatedByName: session.email,
    };

    await db
      .collection("colleges").doc(session.collegeId)
      .collection("timetableDrafts").doc(sectionId)
      .set(draft);

    return NextResponse.json({
      draft: { ...draft, id: sectionId, generatedAt: null },
      pinnedCount: ctx.pinnedSlots.length,
      placedCount: result.slots.length,
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable/generate POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
