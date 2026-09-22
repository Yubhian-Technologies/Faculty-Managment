export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import { isResubmittable, notifyReviewer, resolveSubmissionRoute, routeFields } from "@/lib/research/coordinatorReview";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import type {
  ConferenceWorkshopNature, ConferenceWorkshopType, ConvenerCoordinatorItem, EditorPublicationType,
  EditorialRole, OrganizingCommitteeMemberItem, PublicationScope, PublicationStatus, ResearchServiceFundNature,
  ResearchServiceType, ResourcePersonItem, ReviewerType,
} from "@/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("R_AND_D");
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("researchServices").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    return NextResponse.json({ record: { id: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/research-services/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface ResearchServicePatchBody {
  serviceType?: ResearchServiceType;
  organized?: "YES" | "NO";
  eventType?: ConferenceWorkshopType;
  eventNature?: ConferenceWorkshopNature;
  fundNature?: ResearchServiceFundNature;
  title?: string;
  convenersCount?: number;
  conveners?: ConvenerCoordinatorItem[];
  committeeMembersCount?: number;
  committeeMembers?: OrganizingCommitteeMemberItem[];
  noOfDays?: number;
  academicYear?: string;
  startDate?: string;
  endDate?: string;
  amountSanctioned?: number;
  amountReceived?: number;
  expenditureMade?: number;
  sanctionedLetterUrl?: string;
  brochureUrl?: string;
  scheduleUrl?: string;
  resourcePersonsCount?: number;
  resourcePersons?: ResourcePersonItem[];
  completionReportUrl?: string;
  papersReceived?: number;
  papersAccepted?: number;
  papersPublishedCount?: number;
  papersIndexedCount?: number;
  conferenceProceedingsUrl?: string;
  conferenceProceedingsLink?: string;
  participantsRegisteredInternal?: number;
  participantsRegisteredExternal?: number;
  papersAttendedInternal?: number;
  papersAttendedExternal?: number;
  reviewerType?: ReviewerType;
  reviewerPublicationName?: string;
  reviewerPublisherName?: string;
  reviewerPaperTitle?: string;
  reviewerReviewDate?: string;
  reviewerCertificateUrl?: string;
  editorialRole?: EditorialRole;
  editorPublicationType?: EditorPublicationType;
  editorPublicationName?: string;
  editorPublisher?: string;
  editorPublisherOther?: string;
  editorIssnIsbn?: string;
  editorScope?: PublicationScope;
  editorIndexedIn?: string;
  editorResponsibilities?: string;
  editorPapersChaptersHandled?: number;
  editorAppointmentLetterUrl?: string;
  editorPublicationUrl?: string;
  editorRemarks?: string;
  decision?: "APPROVED" | "REJECTED";
  rejectionReason?: string;
}

const EDITABLE_KEYS = [
  "serviceType", "organized", "eventType", "eventNature", "fundNature", "title", "convenersCount", "conveners",
  "committeeMembersCount", "committeeMembers", "noOfDays", "academicYear", "startDate", "endDate",
  "amountSanctioned", "amountReceived", "expenditureMade", "sanctionedLetterUrl", "brochureUrl", "scheduleUrl",
  "resourcePersonsCount", "resourcePersons", "completionReportUrl", "papersReceived", "papersAccepted",
  "papersPublishedCount", "papersIndexedCount", "conferenceProceedingsUrl", "conferenceProceedingsLink", "participantsRegisteredInternal",
  "participantsRegisteredExternal", "papersAttendedInternal", "papersAttendedExternal", "reviewerType",
  "reviewerPublicationName", "reviewerPublisherName", "reviewerPaperTitle", "reviewerReviewDate",
  "reviewerCertificateUrl", "editorialRole", "editorPublicationType", "editorPublicationName", "editorPublisher",
  "editorPublisherOther", "editorIssnIsbn", "editorScope", "editorIndexedIn", "editorResponsibilities",
  "editorPapersChaptersHandled", "editorAppointmentLetterUrl", "editorPublicationUrl", "editorRemarks",
] as const satisfies readonly (keyof ResearchServicePatchBody)[];

function pickEditableFields(body: ResearchServicePatchBody): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const key of EDITABLE_KEYS) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  return updates;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember(...PUBLICATION_ELIGIBLE_ROLES);
    const { id } = await params;

    const body = (await request.json()) as ResearchServicePatchBody;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("researchServices").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    const record = snap.data() as { uid: string; title?: string; serviceType: ResearchServiceType; status?: PublicationStatus };
    const isRnD = session.role === "R_AND_D";
    const isOwner = record.uid === session.uid;
    if (!isRnD && !isOwner) {
      return NextResponse.json({ error: "Not authorized to edit this record" }, { status: 403 });
    }
    const label = record.title || record.serviceType.toLowerCase();

    if (body.decision) {
      if (!isRnD) {
        return NextResponse.json({ error: "Only R&D can verify a research service record" }, { status: 403 });
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

      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "RD_RESEARCH_SERVICE_UPDATED",
        performedBy: session.uid,
        performedByName: reviewedByName,
        targetId: id,
        details: { title: label, decision: body.decision },
        timestamp: now,
      });

      await notify(
        db, session.collegeId, record.uid,
        "RESEARCH_SERVICE_REVIEWED",
        body.decision === "APPROVED" ? "Research service record approved" : "Research service record rejected",
        body.decision === "APPROVED"
          ? `"${label}" was verified and now shows as an official record`
          : `"${label}" was rejected${body.rejectionReason ? `: ${body.rejectionReason}` : ""} - you can edit and resubmit it`
      );

      return NextResponse.json({ ok: true });
    }

    if (isOwner && !isRnD) {
      if (!isResubmittable(record.status)) {
        return NextResponse.json({ error: "Only a rejected or sent-back submission can be edited" }, { status: 403 });
      }
      const route = await resolveSubmissionRoute(db, session.collegeId, session.uid, false);
      const now = new Date();
      const updates: Record<string, unknown> = {
        ...routeFields(route),
        sentBackReason: FieldValue.delete(),
        coordinatorNote: FieldValue.delete(),
        ...pickEditableFields(body),
        updatedAt: now,
        status: route.status satisfies PublicationStatus,
        reviewedBy: FieldValue.delete(),
        reviewedByName: FieldValue.delete(),
        reviewedAt: FieldValue.delete(),
        rejectionReason: FieldValue.delete(),
      };

      let editorName = "Unknown";
      try {
        const editorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
        editorName = (editorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
      } catch { /* best-effort */ }
      await ref.update(updates);
      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "RD_RESEARCH_SERVICE_UPDATED",
        performedBy: session.uid,
        performedByName: editorName,
        targetId: id,
        details: { title: body.title ?? label },
        timestamp: now,
      });
      await notifyReviewer(db, session.collegeId, route, {
        type: "RESEARCH_SERVICE_PENDING_VERIFICATION", title: "Research service record resubmitted for verification",
        message: `A previously rejected record ("${body.title ?? label}") was corrected and resubmitted`,
        rndLink: "/r-and-d/research-services",
      });
      return NextResponse.json({ ok: true });
    }

    await ref.update({ ...pickEditableFields(body), updatedAt: new Date() });
    let actorName = "Unknown";
    try {
      const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    } catch { /* best-effort */ }
    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "RD_RESEARCH_SERVICE_UPDATED",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: id,
      details: { title: label },
      timestamp: new Date(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/research-services/[id] PATCH]", err);
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
    const ref = db.collection("colleges").doc(session.collegeId).collection("researchServices").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    const record = snap.data() as { title?: string; serviceType?: string; uid?: string };

    await ref.delete();
    let actorName = "Unknown";
    try {
      const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    } catch { /* best-effort */ }
    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "RD_RESEARCH_SERVICE_DELETED",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: id,
      details: { title: record.title ?? record.serviceType, uid: record.uid },
      timestamp: new Date(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/research-services/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
