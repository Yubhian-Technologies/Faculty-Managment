export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { PromotionRecord } from "@/types";

// Promotion History and the salary/budgetary fields are College Office-only -
// neither the faculty member themselves nor their HOD/Principal can touch
// them anymore (see AcademicProfileModuleFields.tsx's ExperienceFields/
// FinancialFields, which no longer render these as editable). This route is
// intentionally narrower than the generic PATCH /api/college/faculty/[id] -
// it only ever merges these five keys into academicProfile, so College
// Office cannot use it to change anything else about the faculty record.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const { id } = await params;

    const body = (await request.json()) as Partial<{
      promotionHistory: PromotionRecord[];
      presentSalary: number;
      grossAnnualCTC: number;
      incrementsAwarded: number;
      fundingConsultancyRevenue: number;
    }>;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("facultyMembers").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const existingProfile = (snap.data() as { academicProfile?: Record<string, unknown> }).academicProfile ?? {};
    const academicProfile = { ...existingProfile };
    if (body.promotionHistory !== undefined) academicProfile.promotionHistory = body.promotionHistory;
    if (body.presentSalary !== undefined) academicProfile.presentSalary = Number(body.presentSalary);
    if (body.grossAnnualCTC !== undefined) academicProfile.grossAnnualCTC = Number(body.grossAnnualCTC);
    if (body.incrementsAwarded !== undefined) academicProfile.incrementsAwarded = Number(body.incrementsAwarded);
    if (body.fundingConsultancyRevenue !== undefined) academicProfile.fundingConsultancyRevenue = Number(body.fundingConsultancyRevenue);

    await ref.update({ academicProfile, updatedAt: new Date() });

    let actorName = "College Office";
    try {
      const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "College Office";
    } catch { /* best-effort */ }

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "FACULTY_UPDATED",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: id,
      details: { fields: Object.keys(body) },
      timestamp: new Date(),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/[id]/promotion-salary PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
