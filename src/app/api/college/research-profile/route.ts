export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notifyRole } from "@/lib/notify";
import { applyResearchProfileFields } from "@/lib/research/applyResearchProfileFields";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import { resolveOwnerDesignation } from "@/lib/publications/resolveOwnerDesignation";
import type { PublicationStatus, UserRole } from "@/types";

// Same eligible-roles list as publications - the researcher IDs this covers
// (ORCID/Scopus/Researcher ID/Google Scholar/IRINS) only make sense for staff
// who can also have publications recorded against them.
const COLLEGE_STAFF_ROLES = PUBLICATION_ELIGIBLE_ROLES;

export async function GET() {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const db = getAdminDb();
    const coll = db.collection("colleges").doc(session.collegeId).collection("researchProfileRequests");

    // R&D manages the review queue and sees every submission; everyone else
    // only ever sees their own (there's exactly one doc, keyed by their uid).
    const query = session.role === "R_AND_D" ? coll : coll.where("uid", "==", session.uid);
    const snap = await query.get();
    const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ requests });
  } catch (err) {
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
    const isRnD = session.role === "R_AND_D";

    const body = (await request.json()) as {
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
    const existingStatus = (existing.data() as { status?: PublicationStatus } | undefined)?.status;
    if (existingStatus === "PENDING") {
      return NextResponse.json({ error: "A submission is already awaiting verification" }, { status: 409 });
    }

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
    // R&D is the verifying authority itself - its own submission is already
    // official, same as R&D's own publication adds.
    const status: PublicationStatus = isRnD ? "APPROVED" : "PENDING";

    await ref.set({
      collegeId: session.collegeId,
      uid: session.uid,
      ownerName: owner?.name ?? "Unknown",
      ownerRole: session.role,
      ...(ownerDesignation ? { ownerDesignation } : {}),
      ...fields,
      status,
      ...(isRnD ? { reviewedBy: session.uid, reviewedByName: owner?.name ?? "R&D", reviewedAt: now } : {}),
      createdAt: existing.exists ? (existing.data() as { createdAt?: unknown }).createdAt ?? now : now,
      updatedAt: now,
    });

    if (isRnD) {
      await applyResearchProfileFields(db, session.collegeId, session.uid, fields);
    } else {
      await notifyRole(
        db, session.collegeId, "R_AND_D",
        "RESEARCH_PROFILE_PENDING_VERIFICATION",
        "Research profile submitted for verification",
        `${owner?.name ?? "A staff member"} submitted their researcher IDs for verification`,
        "/r-and-d/research-profiles"
      );
    }

    return NextResponse.json({ ok: true, status });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/research-profile POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
