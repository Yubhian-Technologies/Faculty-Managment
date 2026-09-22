export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import { isResubmittable, notifyReviewer, resolveSubmissionRoute, routeFields } from "@/lib/research/coordinatorReview";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import type {
  PublicationStatus, SeedFundingEquipmentItem, SeedFundingPaperItem,
  SeedFundingPatentItem, SeedFundingProjectStatus, SeedFundingStudentItem,
} from "@/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("R_AND_D");
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("seedFundingProjects").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Seed funding project not found" }, { status: 404 });
    }

    return NextResponse.json({ project: { id: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/seed-funding/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface SeedFundingPatchBody {
  title?: string;
  durationMonths?: number;
  objectives?: string;
  tentativeOutcomes?: string;
  piName?: string;
  piDepartment?: string;
  studentsInvolvedCount?: number;
  students?: SeedFundingStudentItem[];
  projectStatus?: SeedFundingProjectStatus;
  dateSanctioned?: string;
  dateOfStart?: string;
  financialYearOfStart?: string;
  totalAmountSanctioned?: number;
  recurringAmount?: number;
  nonRecurringAmount?: number;
  equipmentProcured?: SeedFundingEquipmentItem[];
  papersPublished?: SeedFundingPaperItem[];
  patents?: SeedFundingPatentItem[];
  studentsProjectsUG?: number;
  studentsProjectsPG?: number;
  studentsProjectsPhD?: number;
  studentsTrainedCount?: number;
  externalFundedProposalsApplied?: number;
  progressReportUrl?: string;
  utilizationCertificateUrl?: string;
  decision?: "APPROVED" | "REJECTED";
  rejectionReason?: string;
}

const EDITABLE_KEYS = [
  "title", "durationMonths", "objectives", "tentativeOutcomes", "piName", "piDepartment",
  "studentsInvolvedCount", "students", "projectStatus", "dateSanctioned", "dateOfStart",
  "financialYearOfStart", "totalAmountSanctioned", "recurringAmount", "nonRecurringAmount",
  "equipmentProcured", "papersPublished", "patents", "studentsProjectsUG",
  "studentsProjectsPG", "studentsProjectsPhD", "studentsTrainedCount",
  "externalFundedProposalsApplied", "progressReportUrl", "utilizationCertificateUrl",
] as const satisfies readonly (keyof SeedFundingPatchBody)[];

function pickEditableFields(body: SeedFundingPatchBody): Record<string, unknown> {
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

    const body = (await request.json()) as SeedFundingPatchBody;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("seedFundingProjects").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Seed funding project not found" }, { status: 404 });
    }
    const project = snap.data() as { uid: string; title: string; status?: PublicationStatus };
    const isRnD = session.role === "R_AND_D";
    const isOwner = project.uid === session.uid;
    if (!isRnD && !isOwner) {
      return NextResponse.json({ error: "Not authorized to edit this seed funding project" }, { status: 403 });
    }

    if (body.decision) {
      if (!isRnD) {
        return NextResponse.json({ error: "Only R&D can verify a seed funding project" }, { status: 403 });
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
        action: "RD_SEED_FUNDING_UPDATED",
        performedBy: session.uid,
        performedByName: reviewedByName,
        targetId: id,
        details: { title: project.title, decision: body.decision },
        timestamp: now,
      });

      await notify(
        db, session.collegeId, project.uid,
        "SEED_FUNDING_REVIEWED",
        body.decision === "APPROVED" ? "Seed funding project approved" : "Seed funding project rejected",
        body.decision === "APPROVED"
          ? `"${project.title}" was verified and now shows as an official record`
          : `"${project.title}" was rejected${body.rejectionReason ? `: ${body.rejectionReason}` : ""} - you can edit and resubmit it`
      );

      return NextResponse.json({ ok: true });
    }

    if (isOwner && !isRnD) {
      if (!isResubmittable(project.status)) {
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
        action: "RD_SEED_FUNDING_UPDATED",
        performedBy: session.uid,
        performedByName: editorName,
        targetId: id,
        details: { title: body.title ?? project.title },
        timestamp: now,
      });
      await notifyReviewer(db, session.collegeId, route, {
        type: "SEED_FUNDING_PENDING_VERIFICATION", title: "Seed funding project resubmitted for verification",
        message: `A previously rejected seed funding project ("${body.title ?? project.title}") was corrected and resubmitted`,
        rndLink: "/r-and-d/seed-funding",
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
      action: "RD_SEED_FUNDING_UPDATED",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: id,
      details: { title: project.title },
      timestamp: new Date(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/seed-funding/[id] PATCH]", err);
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
    const ref = db.collection("colleges").doc(session.collegeId).collection("seedFundingProjects").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Seed funding project not found" }, { status: 404 });
    }
    const project = snap.data() as { title?: string; uid?: string };

    await ref.delete();
    let actorName = "Unknown";
    try {
      const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    } catch { /* best-effort */ }
    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "RD_SEED_FUNDING_DELETED",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: id,
      details: { title: project.title, uid: project.uid },
      timestamp: new Date(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/seed-funding/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
