export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import { applyResearchProfileFields } from "@/lib/research/applyResearchProfileFields";
import type { PublicationStatus, ResearchProfileRequest } from "@/types";

// R&D's verification decision on a self-submitted PENDING research-profile
// request - the only way these ever change hands (see POST /api/college/
// research-profile for how a staff member submits/resubmits their own).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  try {
    const session = await requireCollegeMember("R_AND_D");
    const { uid } = await params;

    const body = (await request.json()) as { decision?: "APPROVED" | "REJECTED"; rejectionReason?: string };
    if (body.decision !== "APPROVED" && body.decision !== "REJECTED") {
      return NextResponse.json({ error: "decision must be APPROVED or REJECTED" }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("researchProfileRequests").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    const req = snap.data() as ResearchProfileRequest;
    if (req.status !== "PENDING") {
      return NextResponse.json({ error: "Only a pending submission can be reviewed" }, { status: 409 });
    }

    const now = new Date();
    let reviewedByName = "R&D";
    try {
      const reviewerSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      reviewedByName = (reviewerSnap.data() as { name?: string } | undefined)?.name ?? "R&D";
    } catch { /* best-effort */ }

    const status: PublicationStatus = body.decision;
    const updates: Record<string, unknown> = {
      status,
      reviewedBy: session.uid,
      reviewedByName,
      reviewedAt: now,
      updatedAt: now,
    };
    if (status === "REJECTED") updates.rejectionReason = body.rejectionReason ?? "";
    await ref.update(updates);

    if (status === "APPROVED") {
      await applyResearchProfileFields(db, session.collegeId, uid, {
        orcidId: req.orcidId,
        scopusAuthorId: req.scopusAuthorId,
        researcherId: req.researcherId,
        googleScholarId: req.googleScholarId,
        irinsProfile: req.irinsProfile,
      });
    }

    await notify(
      db, session.collegeId, uid,
      "RESEARCH_PROFILE_REVIEWED",
      status === "APPROVED" ? "Research profile approved" : "Research profile rejected",
      status === "APPROVED"
        ? "Your researcher IDs were verified and now show on your profile"
        : `Your researcher ID submission was rejected${body.rejectionReason ? `: ${body.rejectionReason}` : ""} - you can correct and resubmit it`
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/research-profile/[uid] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
