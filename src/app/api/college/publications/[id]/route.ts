export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify, notifyRole } from "@/lib/notify";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import type { PublicationStatus } from "@/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("R_AND_D");
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("publications").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Publication not found" }, { status: 404 });
    }

    return NextResponse.json({ publication: { id: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/publications/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember(...PUBLICATION_ELIGIBLE_ROLES);
    const { id } = await params;

    const body = (await request.json()) as Partial<{
      title: string;
      coAuthors: string;
      citation: string;
      journalOrConference: string;
      publicationYear: number;
      indexing: string;
      driveLink: string;
      // Extra report fields - see ResearchPublication (src/types/core.ts).
      department: string;
      authorPosition: string;
      venueType: string;
      facultyOrStudent: string;
      impactFactor: string;
      sjr: string;
      quartile: string;
      isbnIssn: string;
      // R&D's verification decision on a self-submitted PENDING record.
      decision: "APPROVED" | "REJECTED";
      rejectionReason: string;
    }>;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("publications").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Publication not found" }, { status: 404 });
    }
    const pub = snap.data() as { uid: string; title: string; status?: PublicationStatus };
    const isRnD = session.role === "R_AND_D";
    const isOwner = pub.uid === session.uid;
    if (!isRnD && !isOwner) {
      return NextResponse.json({ error: "Not authorized to edit this publication" }, { status: 403 });
    }

    // R&D's verification decision - approve/reject a self-submitted record.
    if (body.decision) {
      if (!isRnD) {
        return NextResponse.json({ error: "Only R&D can verify a publication" }, { status: 403 });
      }
      const now = new Date();
      let reviewedByName = "R&D";
      try {
        const reviewerSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
        reviewedByName = (reviewerSnap.data() as { name?: string } | undefined)?.name ?? "R&D";
      } catch { /* best-effort */ }

      await ref.update({
        status: body.decision,
        reviewedBy: session.uid,
        reviewedByName,
        reviewedAt: now,
        updatedAt: now,
        ...(body.decision === "REJECTED" ? { rejectionReason: body.rejectionReason ?? "" } : { rejectionReason: FieldValue.delete() }),
      });

      await notify(
        db, session.collegeId, pub.uid,
        "PUBLICATION_REVIEWED",
        body.decision === "APPROVED" ? "Publication approved" : "Publication rejected",
        body.decision === "APPROVED"
          ? `"${pub.title}" was verified and now shows as an official record`
          : `"${pub.title}" was rejected${body.rejectionReason ? `: ${body.rejectionReason}` : ""} - you can edit and resubmit it`
      );

      return NextResponse.json({ ok: true });
    }

    // Owner editing+resubmitting their own rejected submission - the same
    // plain content fields the self-submit form collects, not R&D's
    // report-only extras (department/authorPosition/venueType/etc.), which
    // stay R&D-only below.
    if (isOwner && !isRnD) {
      if (pub.status !== "REJECTED") {
        return NextResponse.json({ error: "Only a rejected submission can be edited" }, { status: 403 });
      }
      const now = new Date();
      const updates: Record<string, unknown> = {
        updatedAt: now,
        status: "PENDING" satisfies PublicationStatus,
        reviewedBy: FieldValue.delete(),
        reviewedByName: FieldValue.delete(),
        reviewedAt: FieldValue.delete(),
        rejectionReason: FieldValue.delete(),
      };
      if (body.title !== undefined) updates.title = body.title;
      if (body.coAuthors !== undefined) updates.coAuthors = body.coAuthors;
      if (body.journalOrConference !== undefined) updates.journalOrConference = body.journalOrConference;
      if (body.publicationYear !== undefined) updates.publicationYear = body.publicationYear;
      if (body.indexing !== undefined) updates.indexing = body.indexing;
      if (body.driveLink !== undefined) updates.driveLink = body.driveLink;

      await ref.update(updates);
      await notifyRole(
        db, session.collegeId, "R_AND_D",
        "PUBLICATION_PENDING_VERIFICATION",
        "Publication resubmitted for verification",
        `A previously rejected publication ("${body.title ?? pub.title}") was corrected and resubmitted`,
        "/r-and-d/publications"
      );
      return NextResponse.json({ ok: true });
    }

    // R&D's own full edit - any field, any status.
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) updates.title = body.title;
    if (body.coAuthors !== undefined) updates.coAuthors = body.coAuthors;
    if (body.citation !== undefined) updates.citation = body.citation;
    if (body.journalOrConference !== undefined) updates.journalOrConference = body.journalOrConference;
    if (body.publicationYear !== undefined) updates.publicationYear = body.publicationYear;
    if (body.indexing !== undefined) updates.indexing = body.indexing;
    if (body.department !== undefined) updates.department = body.department;
    if (body.authorPosition !== undefined) updates.authorPosition = body.authorPosition;
    if (body.venueType !== undefined) updates.venueType = body.venueType;
    if (body.facultyOrStudent !== undefined) updates.facultyOrStudent = body.facultyOrStudent;
    if (body.impactFactor !== undefined) updates.impactFactor = body.impactFactor;
    if (body.sjr !== undefined) updates.sjr = body.sjr;
    if (body.quartile !== undefined) updates.quartile = body.quartile;
    if (body.isbnIssn !== undefined) updates.isbnIssn = body.isbnIssn;
    if (body.driveLink !== undefined) updates.driveLink = body.driveLink;

    await ref.update(updates);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/publications/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("R_AND_D");
    const { id } = await params;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("publications").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Publication not found" }, { status: 404 });
    }

    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/publications/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
