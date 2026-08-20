export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { academicRegulationsRef, loadAcademicRegulations } from "@/lib/firestore/academicRegulations";
import type { AcademicRegulationSettings } from "@/types/core";

// colleges/{collegeId}/settings/academicRegulations - the college-wide
// curriculum regulation codes (e.g. R20, R23) the Principal maintains. Which
// ones apply to a given course, and to which of its years, is set per-course
// instead (see api/college/course-catalog). Super Admin can view/edit any
// college via ?collegeId=, matching /api/college/settings/general.
function resolveCollegeId(request: Request, role: string, sessionCollegeId: string): string | null {
  if (role === "SUPER_ADMIN") {
    return new URL(request.url).searchParams.get("collegeId");
  }
  return sessionCollegeId || null;
}

export async function GET(request: Request) {
  try {
    const session = await requireRole("SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "DEAN");
    const collegeId = resolveCollegeId(request, session.role, session.collegeId);
    if (!collegeId) {
      return NextResponse.json({ error: "collegeId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const settings = await loadAcademicRegulations(db, collegeId);
    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/settings/regulations GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    // HOD included alongside the Principal tier: an HOD maintains their own
    // department's curriculum, so they need to keep the regulation codes and
    // their intake batches current rather than waiting on the Principal.
    //
    // Note this is a COLLEGE-WIDE setting, not a per-department one - there is
    // one list of regulations and one batch mapping for the whole college
    // (AcademicRegulationSettings), so an edit by any HOD is visible to every
    // department. That's inherent to where this data lives, not something the
    // route can scope.
    const session = await requireRole("SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL", "HOD");
    const body = (await request.json()) as Partial<AcademicRegulationSettings> & { collegeId?: string };

    const collegeId = session.role === "SUPER_ADMIN" ? body.collegeId : session.collegeId;
    if (!collegeId) {
      return NextResponse.json({ error: "collegeId is required" }, { status: 400 });
    }

    const regulations = Array.from(
      new Set((body.regulations ?? []).map((r) => r.trim()).filter(Boolean))
    );
    if (regulations.length === 0) {
      return NextResponse.json({ error: "Add at least one regulation" }, { status: 400 });
    }

    // Only ever keeps entries for regulation codes actually in the list above -
    // a removed regulation's batch label is dropped along with it, rather than
    // lingering as an orphaned key nothing can reach anymore.
    const regulationBatches: Record<string, string> = {};
    for (const code of regulations) {
      const batch = body.regulationBatches?.[code]?.trim();
      if (batch) regulationBatches[code] = batch;
    }

    const db = getAdminDb();
    const settings: AcademicRegulationSettings = {
      regulations,
      regulationBatches,
      updatedAt: new Date() as unknown as AcademicRegulationSettings["updatedAt"],
      updatedByName: session.email || "Unknown",
    };

    await academicRegulationsRef(db, collegeId).set(settings, { merge: true });

    await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
      collegeId,
      action: "ACADEMIC_REGULATIONS_UPDATED",
      performedBy: session.uid,
      performedByName: settings.updatedByName,
      details: { regulations },
      timestamp: new Date(),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/settings/regulations PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
