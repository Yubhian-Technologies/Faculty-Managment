export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notifyRole } from "@/lib/notify";
import { applyCitationMetricsFields } from "@/lib/research/applyCitationMetricsFields";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import { resolveOwnerDesignation } from "@/lib/publications/resolveOwnerDesignation";
import type { PublicationStatus, UserRole } from "@/types";

// Same eligible-roles list as publications/research-profile - a citation
// metrics record only makes sense for staff who can also have publications
// recorded against them.
const COLLEGE_STAFF_ROLES = PUBLICATION_ELIGIBLE_ROLES;

export async function GET() {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const db = getAdminDb();
    const coll = db.collection("colleges").doc(session.collegeId).collection("citationMetricsRequests");

    // R&D manages the review queue and sees every submission; everyone else
    // only ever sees their own (one doc per uid, keyed by uid).
    const query = session.role === "R_AND_D" ? coll : coll.where("uid", "==", session.uid);
    const snap = await query.get();
    const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({ requests });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/citation-metrics GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const isRnD = session.role === "R_AND_D";

    const body = (await request.json()) as {
      totalCitations?: number | string;
      hIndex?: number | string;
      citationsExcludingSelf?: number | string;
      hIndexExcludingSelf?: number | string;
    };

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const ref = collegeRef.collection("citationMetricsRequests").doc(session.uid);
    const existing = await ref.get();
    const existingStatus = (existing.data() as { status?: PublicationStatus } | undefined)?.status;
    if (existingStatus === "PENDING") {
      return NextResponse.json({ error: "A submission is already awaiting verification" }, { status: 409 });
    }

    const ownerSnap = await collegeRef.collection("users").doc(session.uid).get();
    const owner = ownerSnap.data() as { name?: string } | undefined;
    const ownerDesignation = await resolveOwnerDesignation(db, session.collegeId, session.uid, session.role as UserRole);

    const num = (v: number | string | undefined) => (v === undefined || v === "" ? undefined : Number(v));
    const fields = {
      totalCitations: num(body.totalCitations) ?? 0,
      hIndex: num(body.hIndex) ?? 0,
      citationsExcludingSelf: num(body.citationsExcludingSelf) ?? 0,
      hIndexExcludingSelf: num(body.hIndexExcludingSelf) ?? 0,
    };

    const now = new Date();
    // R&D is the verifying authority itself - its own submission is already
    // official, same as R&D's own publication/research-profile adds.
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
      await applyCitationMetricsFields(db, session.collegeId, session.uid, fields);
    } else {
      await notifyRole(
        db, session.collegeId, "R_AND_D",
        "CITATION_METRICS_PENDING_VERIFICATION",
        "Citation metrics submitted for verification",
        `${owner?.name ?? "A staff member"} submitted their citation metrics for verification`,
        "/r-and-d/citation-metrics"
      );
    }

    return NextResponse.json({ ok: true, status });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/citation-metrics POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
