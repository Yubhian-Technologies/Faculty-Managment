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

    const db = getAdminDb();
    const settings: AcademicRegulationSettings = {
      regulations,
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
