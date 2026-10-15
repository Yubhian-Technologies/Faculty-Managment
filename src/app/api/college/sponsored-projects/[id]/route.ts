export const dynamic = "force-dynamic";

import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { holdsRole } from "@/lib/roles/seatRoles";
import { notify } from "@/lib/notify";
import { notifyReviewer, resolveSubmissionRoute, routeFields } from "@/lib/research/coordinatorReview";
import { buildEditTrail, clearEditTrail, summarizeFieldChanges } from "@/lib/research/changeTracking";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import { validateSponsoredProjectBody } from "@/lib/research/validateSponsoredProject";
import { finalizeSponsoredCoPis } from "@/lib/research/finalizeSponsoredCoPis";
import type {
  PublicationStatus, SponsoredProjectCoPI, SponsoredProjectRequest, SponsoredProjectSanctionedStatus,
  SponsoredProjectStatus, SponsoredProjectType, SponsoredProjectYearData,
} from "@/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("R_AND_D");
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("sponsoredProjects").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Sponsored project not found" }, { status: 404 });
    }

    return NextResponse.json({ project: { id: snap.id, ...snap.data() } });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/sponsored-projects/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface SponsoredProjectPatchBody {
  agencyName?: string;
  schemeName?: string;
  applicationNumber?: string;
  title?: string;
  projectType?: SponsoredProjectType;
  durationMonths?: number;
  objectives?: string;
  tentativeOutcomes?: string;
  piName?: string;
  piDepartment?: string;
  piAffiliation?: string;
  coPiCount?: number;
  coPis?: SponsoredProjectCoPI[];
  projectStatus?: SponsoredProjectStatus;
  dateProposalSubmitted?: string;
  amountApplied?: number;
  extendedToSeedFund?: "YES" | "NO";
  seedFundTitle?: string;
  seedFundAmountSanctioned?: number | null;
  seedFundSanctionDate?: string;
  sanctionedStatus?: SponsoredProjectSanctionedStatus;
  dateProjectSanctioned?: string;
  dateOfStart?: string;
  financialYearOfStart?: string;
  totalAmountSanctioned?: number;
  recurringAmountSanctioned?: number;
  nonRecurringAmountSanctioned?: number;
  instituteContributionSanctioned?: number;
  dateOfCompletion?: string;
  financialYearOfCompletion?: string;
  noOfYears?: number;
  yearlyData?: SponsoredProjectYearData[];
  progressReportUrl?: string;
  completionReportUrl?: string;
  utilizationCertificateUrl?: string;
  statementOfExpenditureUrl?: string;
  submittedRequiredDocs?: "YES" | "NO";
  dateOfSubmission?: string;
  decision?: "APPROVED" | "REJECTED";
  rejectionReason?: string;
}

const EDITABLE_KEYS = [
  "agencyName", "schemeName", "applicationNumber", "title", "projectType", "durationMonths",
  "objectives", "tentativeOutcomes", "piName", "piDepartment", "piAffiliation", "coPiCount", "coPis",
  "projectStatus", "dateProposalSubmitted", "amountApplied", "extendedToSeedFund", "seedFundTitle",
  "seedFundAmountSanctioned", "seedFundSanctionDate", "sanctionedStatus",
  "dateProjectSanctioned", "dateOfStart", "financialYearOfStart", "totalAmountSanctioned",
  "recurringAmountSanctioned", "nonRecurringAmountSanctioned", "instituteContributionSanctioned",
  "dateOfCompletion", "financialYearOfCompletion", "noOfYears", "yearlyData", "progressReportUrl",
  "completionReportUrl", "utilizationCertificateUrl", "statementOfExpenditureUrl", "submittedRequiredDocs",
  "dateOfSubmission",
] as const satisfies readonly (keyof SponsoredProjectPatchBody)[];

function pickEditableFields(body: SponsoredProjectPatchBody): Record<string, unknown> {
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

    const body = (await readJsonBody(request)) as SponsoredProjectPatchBody;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("sponsoredProjects").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Sponsored project not found" }, { status: 404 });
    }
    const project = snap.data() as SponsoredProjectRequest;
    const isRnD = holdsRole(session, "R_AND_D");
    const isOwner = project.uid === session.uid;
    if (!isRnD && !isOwner) {
      return NextResponse.json({ error: "Not authorized to edit this sponsored project" }, { status: 403 });
    }

    if (body.decision) {
      if (!isRnD) {
        return NextResponse.json({ error: "Only R&D can verify a sponsored project" }, { status: 403 });
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
        ...(body.decision === "APPROVED" ? clearEditTrail() : {}),
        ...(body.decision === "REJECTED" ? { rejectionReason: body.rejectionReason ?? "" } : { rejectionReason: FieldValue.delete() }),
      });

      await writeAuditLogSafe(db, session.collegeId, { action: "RD_SPONSORED_PROJECT_UPDATED", performedBy: session.uid, performedByName: reviewedByName, targetId: id, details: { title: project.title, decision: body.decision } });

      await notify(
        db, session.collegeId, project.uid,
        "SPONSORED_PROJECT_REVIEWED",
        body.decision === "APPROVED" ? "Sponsored project approved" : "Sponsored project rejected",
        body.decision === "APPROVED"
          ? `"${project.title}" was verified and now shows as an official record`
          : `"${project.title}" was rejected${body.rejectionReason ? `: ${body.rejectionReason}` : ""} - you can edit and resubmit it`
      );

      return NextResponse.json({ ok: true });
    }

    // Co-PIs from this college are resolved against the faculty records; the rest are kept as typed.
    let finalCoPis: SponsoredProjectCoPI[] | undefined;
    let finalUids: string[] | undefined;
    if (body.coPis !== undefined) {
      const finalized = await finalizeSponsoredCoPis(db, session.collegeId, body.coPis);
      if ("error" in finalized) return NextResponse.json({ error: finalized.error }, { status: 400 });
      finalCoPis = finalized.coPis;
      finalUids = finalized.internalAuthorUids;
    }

    // An owner editing their OWN record always sends it back for verification -
    // at any status, not just a rejected or sent-back one, and including an
    // owner who is also the R&D head. Editing is a separate act from
    // reviewing: the decision branch above is still the only way to approve,
    // and R&D can still approve their own record there.
    if (isOwner) {
      const wasApproved = project.status === "APPROVED";

      const validationError = validateSponsoredProjectBody({ ...project, ...body });
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }

      const route = await resolveSubmissionRoute(db, session.collegeId, session.uid, isRnD);
      const now = new Date();
      const updates: Record<string, unknown> = {
        ...routeFields(route),
        sentBackReason: FieldValue.delete(),
        coordinatorNote: FieldValue.delete(),
        ...pickEditableFields(body),
        ...(finalCoPis ? { coPis: finalCoPis, internalAuthorUids: finalUids } : {}),
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
      // After an approved record is edited, say exactly which fields moved (vs the verified version).
      const trail = buildEditTrail({
        existing: snap.data() as Record<string, unknown>, incoming: updates, moduleSlug: "sponsored-projects",
        editorUid: session.uid, editorName, now,
      });
      Object.assign(updates, trail.updates);
      await ref.update(updates);
      await writeAuditLogSafe(db, session.collegeId, { action: "RD_SPONSORED_PROJECT_UPDATED", performedBy: session.uid, performedByName: editorName, targetId: id, details: { title: body.title ?? project.title } });
      await notifyReviewer(db, session.collegeId, route, {
        type: "SPONSORED_PROJECT_PENDING_VERIFICATION", title: wasApproved ? "Sponsored project edited after approval - re-verification needed" : "Sponsored project resubmitted for verification",
        message: wasApproved
          ? `Sponsored project ("${body.title ?? project.title}") was edited after approval and needs re-verification - changed: ${summarizeFieldChanges(trail.changes)}`
          : `A previously rejected sponsored project ("${body.title ?? project.title}") was corrected and resubmitted`,
        rndLink: "/r-and-d/sponsored-projects",
      });
      return NextResponse.json({ ok: true });
    }

    await ref.update({ ...pickEditableFields(body), ...(finalCoPis ? { coPis: finalCoPis, internalAuthorUids: finalUids } : {}), updatedAt: new Date() });
    let actorName = "Unknown";
    try {
      const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    } catch { /* best-effort */ }
    await writeAuditLogSafe(db, session.collegeId, { action: "RD_SPONSORED_PROJECT_UPDATED", performedBy: session.uid, performedByName: actorName, targetId: id, details: { title: project.title } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/sponsored-projects/[id] PATCH]", err);
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
    const ref = db.collection("colleges").doc(session.collegeId).collection("sponsoredProjects").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Sponsored project not found" }, { status: 404 });
    }
    const project = snap.data() as { title?: string; uid?: string };

    await ref.delete();
    let actorName = "Unknown";
    try {
      const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    } catch { /* best-effort */ }
    await writeAuditLogSafe(db, session.collegeId, { action: "RD_SPONSORED_PROJECT_DELETED", performedBy: session.uid, performedByName: actorName, targetId: id, details: { title: project.title, uid: project.uid } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/sponsored-projects/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
