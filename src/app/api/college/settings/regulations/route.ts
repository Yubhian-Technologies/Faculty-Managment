export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { academicRegulationsRef, loadAcademicRegulations } from "@/lib/firestore/academicRegulations";
import type { AcademicRegulationSettings } from "@/types/core";

const YEARS = ["1", "2", "3", "4"];

// colleges/{collegeId}/settings/academicRegulations - the curriculum
// regulation(s) (e.g. R20, R23) the Principal maintains and fixes one of
// per year of study (1st-4th). Super Admin can view/edit any college via
// ?collegeId=, matching /api/college/settings/general.
function resolveCollegeId(request: Request, role: string, sessionCollegeId: string): string | null {
  if (role === "SUPER_ADMIN") {
    return new URL(request.url).searchParams.get("collegeId");
  }
  return sessionCollegeId || null;
}

export async function GET(request: Request) {
  try {
    const session = await requireRole("SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL", "HOD");
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
    const session = await requireRole("SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL");
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

    const yearRegulations: Record<string, string> = {};
    for (const year of YEARS) {
      const value = body.yearRegulations?.[year];
      if (!value) continue;
      if (!regulations.includes(value)) {
        return NextResponse.json({ error: `Year ${year}'s regulation isn't in the list above` }, { status: 400 });
      }
      yearRegulations[year] = value;
    }

    const db = getAdminDb();
    const settings: AcademicRegulationSettings = {
      regulations,
      yearRegulations,
      updatedAt: new Date() as unknown as AcademicRegulationSettings["updatedAt"],
      updatedByName: session.email || "Unknown",
    };

    await academicRegulationsRef(db, collegeId).set(settings, { merge: true });

    await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
      collegeId,
      action: "ACADEMIC_REGULATIONS_UPDATED",
      performedBy: session.uid,
      performedByName: settings.updatedByName,
      details: { regulations, yearRegulations },
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
