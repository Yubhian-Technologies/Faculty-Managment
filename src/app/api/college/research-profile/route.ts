export const dynamic = "force-dynamic";

import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { holdsRole } from "@/lib/roles/seatRoles";
import { wantsWholeCollege } from "@/lib/research/listScope";
import { notifyRole } from "@/lib/notify";
import { buildEditTrail, summarizeFieldChanges } from "@/lib/research/changeTracking";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import { resolveOwnerDesignation } from "@/lib/publications/resolveOwnerDesignation";
import type { PublicationStatus, UserRole } from "@/types";

// Same eligible-roles list as publications - the researcher IDs this covers
// (ORCID/Scopus/Researcher ID/Google Scholar/IRINS) only make sense for staff
// who can also have publications recorded against them.
const COLLEGE_STAFF_ROLES = PUBLICATION_ELIGIBLE_ROLES;

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const db = getAdminDb();
    const coll = db.collection("colleges").doc(session.collegeId).collection("researchProfileRequests");

    // R&D sees every submission on its review page, which asks for it; the
    // same endpoint answers the caller's own My Work module page, and there
    // they get only their own (see wantsWholeCollege). (there's exactly one doc, keyed by their uid).
    const query = wantsWholeCollege(request, holdsRole(session, "R_AND_D"))
      ? coll
      : coll.where("uid", "==", session.uid);
    const snap = await query.get();
    const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ requests });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/research-profile GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);

    const body = (await readJsonBody(request)) as {
      orcidId?: string;
      scopusAuthorId?: string;
      researcherId?: string;
      googleScholarId?: string;
      irinsProfile?: string;
    };

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const ref = collegeRef.collection("researchProfileRequests").doc(session.uid);
    const existing = await ref.get();
    // A still-pending submission can be edited in place: the owner may fix a
    // value before anyone has verified it, and it stays in R&D's queue.
    const ownerSnap = await collegeRef.collection("users").doc(session.uid).get();
    const owner = ownerSnap.data() as { name?: string } | undefined;
    const ownerDesignation = await resolveOwnerDesignation(db, session.collegeId, session.uid, session.role as UserRole);

    const fields = {
      orcidId: (body.orcidId ?? "").trim(),
      scopusAuthorId: (body.scopusAuthorId ?? "").trim(),
      researcherId: (body.researcherId ?? "").trim(),
      googleScholarId: (body.googleScholarId ?? "").trim(),
      irinsProfile: (body.irinsProfile ?? "").trim(),
    };

    const now = new Date();
    // Every submission is verified, R&D's own included - they approve it for
    // themselves from the review page. See resolveSubmissionRoute.
    const status: PublicationStatus = "PENDING";

    // An already-verified record that is edited carries exactly what changed
    // (field, verified value, new value) so the reviewer sees it again.
    const trail = buildEditTrail({
      existing: (existing.data() ?? {}) as Record<string, unknown>,
      incoming: fields,
      moduleSlug: "research-profiles",
      editorUid: session.uid, editorName: owner?.name ?? "Unknown", now,
    });

    await ref.set({
      collegeId: session.collegeId,
      uid: session.uid,
      ownerName: owner?.name ?? "Unknown",
      ownerRole: session.role,
      ...(ownerDesignation ? { ownerDesignation } : {}),
      ...fields,
      status,
      ...trail.updates,
      createdAt: existing.exists ? (existing.data() as { createdAt?: unknown }).createdAt ?? now : now,
      updatedAt: now,
    });

    await writeAuditLogSafe(db, session.collegeId, { action: existing.exists ? "RD_RESEARCH_PROFILE_UPDATED" : "RD_RESEARCH_PROFILE_CREATED", performedBy: session.uid, performedByName: owner?.name ?? "Unknown", targetId: session.uid, details: { uid: session.uid, orcidId: fields.orcidId } });

    // The values reach the faculty profile only once R&D approves (the
    // approval route calls applyResearchProfileFields) - never on submission.
    await notifyRole(
      db, session.collegeId, "R_AND_D",
      "RESEARCH_PROFILE_PENDING_VERIFICATION",
      trail.reopened ? "Research profile edited after verification - re-verification needed" : "Research profile submitted for verification",
      trail.reopened
        ? `${owner?.name ?? "A staff member"} edited their verified researcher IDs - changed: ${summarizeFieldChanges(trail.changes)}`
        : `${owner?.name ?? "A staff member"} submitted their researcher IDs for verification`,
      "/r-and-d/research-profiles"
    );

    return NextResponse.json({ ok: true, status });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/research-profile POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
