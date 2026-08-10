export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { PromotionRecord } from "@/types";

// HOD and Principal keep their self-reported academic profile on their own
// login doc (colleges/{id}/users/{uid}), not a facultyMembers record - see
// promotion-salary/route.ts under college/faculty/[id] for the roster
// equivalent. Same policy here: College Office only, and only these five
// keys - never routed through the generic PATCH /api/college/users/[uid],
// which allows far more than Office should be able to touch on these roles.
const EDITABLE_ROLES = ["HOD", "PRINCIPAL"];

async function loadTarget(db: FirebaseFirestore.Firestore, collegeId: string, uid: string) {
  const ref = db.collection("colleges").doc(collegeId).collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return { ref: null, data: null };
  const data = snap.data() as { role?: string; name?: string; academicProfile?: Record<string, unknown> };
  if (!data.role || !EDITABLE_ROLES.includes(data.role)) return { ref: null, data: null };
  return { ref, data };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const { uid } = await params;
    const db = getAdminDb();

    const { data } = await loadTarget(db, session.collegeId, uid);
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({
      user: { uid, name: data.name ?? "", role: data.role, academicProfile: data.academicProfile ?? {} },
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/users/[uid]/promotion-salary GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const { uid } = await params;

    const body = (await request.json()) as Partial<{
      promotionHistory: PromotionRecord[];
      presentSalary: number;
      grossAnnualCTC: number;
      incrementsAwarded: number;
      fundingConsultancyRevenue: number;
    }>;

    const db = getAdminDb();
    const { ref, data } = await loadTarget(db, session.collegeId, uid);
    if (!ref || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const academicProfile = { ...(data.academicProfile ?? {}) };
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
      action: "USER_UPDATED",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: uid,
      details: { fields: Object.keys(body) },
      timestamp: new Date(),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/users/[uid]/promotion-salary PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
