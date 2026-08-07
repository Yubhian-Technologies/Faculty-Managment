export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { collegeSettingsRef, loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import type { FacultyNorms } from "@/types/core";

// colleges/{collegeId}/settings/general - basic college info a Principal
// manages for their own college (student:faculty ratio, teaching hours,
// position norms, and the leave module's new-joining conversion threshold).
// Super Admin can view/edit any college via ?collegeId=.
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
    const settings = await loadCollegeSettings(db, collegeId);
    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/settings/general GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireRole("SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL");
    const body = (await request.json()) as Partial<FacultyNorms> & { collegeId?: string };

    const collegeId = session.role === "SUPER_ADMIN" ? body.collegeId : session.collegeId;
    if (!collegeId) {
      return NextResponse.json({ error: "collegeId is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const current = await loadCollegeSettings(db, collegeId);

    const settings: FacultyNorms = {
      regulatoryBody: body.regulatoryBody ?? current.regulatoryBody,
      studentFacultyRatio: Number(body.studentFacultyRatio ?? current.studentFacultyRatio),
      teachingHoursPerWeek: Number(body.teachingHoursPerWeek ?? current.teachingHoursPerWeek),
      defaultMinFacultyPerDept: Number(body.defaultMinFacultyPerDept ?? current.defaultMinFacultyPerDept),
      minimumQualifications: body.minimumQualifications ?? current.minimumQualifications,
      positionNorms: body.positionNorms ?? current.positionNorms,
      newJoiningYears: Number(body.newJoiningYears ?? current.newJoiningYears),
      updatedAt: new Date() as unknown as FacultyNorms["updatedAt"],
      updatedByName: session.email || "Unknown",
    };

    if (settings.newJoiningYears < 0) {
      return NextResponse.json({ error: "newJoiningYears must be 0 or more" }, { status: 400 });
    }

    await collegeSettingsRef(db, collegeId).set(settings, { merge: true });

    await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
      collegeId,
      action: "COLLEGE_SETTINGS_UPDATED",
      performedBy: session.uid,
      performedByName: settings.updatedByName,
      details: { newJoiningYears: settings.newJoiningYears, studentFacultyRatio: settings.studentFacultyRatio },
      timestamp: new Date(),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/settings/general PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
