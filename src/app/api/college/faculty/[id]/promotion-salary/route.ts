export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { normalizeAcademicProfile } from "@/lib/faculty/academicProfileCompat";
import { designationKey } from "@/lib/designations/config";
import {
  validatePromotionHistory, normalizePromotionHistory, runningDesignation, samePromotionHistory, toDateOnly,
  type PromotionIssue,
} from "@/lib/faculty/promotionHistory";
import type { PromotionRecord } from "@/types";

// Promotion History and the salary/budgetary fields are College Office-only -
// neither the faculty member themselves nor their HOD/Principal can touch
// them anymore (see AcademicProfileModuleFields.tsx's ExperienceFields/
// FinancialFields, which no longer render these as editable). This route is
// intentionally narrower than the generic PATCH /api/college/faculty/[id] -
// it only ever merges these five keys into academicProfile (plus, when the
// Promotion History changes, the faculty's current `designation` - see below),
// so College Office cannot use it to change anything else about the faculty record.
//
// Promotion History rules (src/lib/faculty/promotionHistory.ts) are enforced here,
// not just in the page: a chronological, gap-free, overlap-free chain, each
// designation once, no future dates, first period starting on the Date of Joining,
// exactly one running period (none for Resigned/Retired). A valid history also
// writes facultyMembers.designation = the running period's designation in the
// SAME update, so the Faculty record can never disagree with it.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const { id } = await params;

    const body = (await request.json()) as Partial<{
      promotionHistory: PromotionRecord[];
      monthlySalary: number;
      grossAnnualCTC: number;
      incrementsAwarded: number;
      fundingConsultancyRevenueGeneration: number;
    }>;
    // The client sends its whole academicProfile; lift any legacy key names in it
    // (presentSalary, fundingConsultancyRevenue, promotion orderUrl) so a client
    // still on the old shape can't write the old names back.
    const normalizedBody = normalizeAcademicProfile(body);

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("facultyMembers").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const facultyData = snap.data() as { academicProfile?: Record<string, unknown>; joiningDate?: unknown; status?: string; designation?: string };
    const existingProfile = facultyData.academicProfile ?? {};
    // Lift the stored profile to the current key names before merging, so the
    // saved map never mixes old and new keys.
    const academicProfile = { ...normalizeAcademicProfile(existingProfile) };

    // Promotion History: only validated/synced when this save actually changes it - a
    // salary-only save on a faculty member whose stored history predates these rules
    // must still go through, and must not silently rewrite that history.
    let syncedDesignation: string | undefined;
    if (normalizedBody.promotionHistory !== undefined) {
      const incoming = normalizedBody.promotionHistory as PromotionRecord[];
      const stored = ((academicProfile.promotionHistory as PromotionRecord[] | undefined) ?? []);
      if (!samePromotionHistory(incoming, stored)) {
        const issues: PromotionIssue[] = validatePromotionHistory(incoming, {
          joiningDate: toDateOnly(facultyData.joiningDate),
          status: facultyData.status,
        });
        // Designations must come from this college's own FACULTY catalogue (the same list
        // the dropdown offers); the catalogue's exact value is what gets stored.
        const catalogSnap = await db.collection("colleges").doc(session.collegeId).collection("designations")
          .where("category", "==", "FACULTY").where("isActive", "==", true).get();
        const catalog = catalogSnap.docs.map((d) => (d.data() as { name?: string }).name).filter((n): n is string => !!n);
        const rows = incoming.map((row) => ({ ...row }));
        if (catalog.length > 0) {
          rows.forEach((row, idx) => {
            if (!row.designation?.trim()) return;
            const match = catalog.find((n) => designationKey(n) === designationKey(row.designation));
            if (!match) issues.push({ row: idx, field: "designation", message: `"${row.designation}" is not in this college's designation catalogue.` });
            else row.designation = match;
          });
        }
        if (issues.length > 0) {
          return NextResponse.json({ error: issues[0].message, issues }, { status: 400 });
        }
        const normalizedHistory = normalizePromotionHistory(rows);
        academicProfile.promotionHistory = normalizedHistory;
        const running = runningDesignation(normalizedHistory);
        if (running && running !== facultyData.designation) syncedDesignation = running;
      }
    }
    if (normalizedBody.monthlySalary !== undefined) academicProfile.monthlySalary = Number(normalizedBody.monthlySalary);
    if (normalizedBody.grossAnnualCTC !== undefined) academicProfile.grossAnnualCTC = Number(normalizedBody.grossAnnualCTC);
    if (normalizedBody.incrementsAwarded !== undefined) academicProfile.incrementsAwarded = Number(normalizedBody.incrementsAwarded);
    if (normalizedBody.fundingConsultancyRevenueGeneration !== undefined) academicProfile.fundingConsultancyRevenueGeneration = Number(normalizedBody.fundingConsultancyRevenueGeneration);

    await ref.update({
      academicProfile,
      ...(syncedDesignation !== undefined ? { designation: syncedDesignation } : {}),
      updatedAt: new Date(),
    });

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
      details: {
        fields: Object.keys(body),
        ...(syncedDesignation !== undefined ? { designation: { from: facultyData.designation ?? null, to: syncedDesignation } } : {}),
      },
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
