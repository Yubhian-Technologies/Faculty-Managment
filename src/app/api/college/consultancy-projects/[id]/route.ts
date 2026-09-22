export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import { finalizeFacultyConsultants } from "@/lib/research/finalizeConsultants";
import { validateConsultancyBody } from "@/lib/research/validateConsultancyProject";
import { isResubmittable, notifyReviewer, resolveSubmissionRoute, routeFields } from "@/lib/research/coordinatorReview";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import { CONSULTANCY_CATEGORIES, CONSULTANCY_CLIENT_TYPES, CONSULTANCY_DELIVERABLES } from "@/lib/research/consultancyProjectOptions";
import type { ConsultancyCategory, ConsultancyClientType, ConsultancyDeliverable, PublicationStatus } from "@/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("R_AND_D");
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("consultancyProjects").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Consultancy project not found" }, { status: 404 });
    }

    return NextResponse.json({ project: { id: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/consultancy-projects/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface ConsultancyProjectPatchBody {
  title?: string;
  facultyConsultantIds?: string[];
  department?: string;
  clientName?: string;
  clientType?: ConsultancyClientType;
  consultancyCategory?: ConsultancyCategory;
  problemStatement?: string;
  projectStatus?: "ONGOING" | "COMPLETED";
  startDate?: string;
  endDate?: string;
  durationMonths?: number;
  consultancyAmount?: number;
  amountReceived?: number;
  amountReceivedDate?: string;
  institutionalInfrastructureUsage?: "YES" | "NO";
  hoursSpentDuringAcademicHours?: number;
  institutionalShare?: number;
  facultyShare?: number;
  facultyShareProofUrl?: string;
  deliverables?: ConsultancyDeliverable[];
  completionReportUrl?: string;
  incomeSupportingDocUrl?: string;
  // R&D's verification decision on a self-submitted PENDING record.
  decision?: "APPROVED" | "REJECTED";
  rejectionReason?: string;
}

const EDITABLE_KEYS = [
  "title", "department",
  "clientName", "clientType", "consultancyCategory", "problemStatement",
  "projectStatus", "startDate", "endDate", "durationMonths", "consultancyAmount", "amountReceived",
  "amountReceivedDate", "institutionalInfrastructureUsage", "hoursSpentDuringAcademicHours",
  "institutionalShare", "facultyShare", "facultyShareProofUrl", "deliverables",
  "completionReportUrl", "incomeSupportingDocUrl",
] as const satisfies readonly (keyof ConsultancyProjectPatchBody)[];

function pickEditableFields(body: ConsultancyProjectPatchBody): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const key of EDITABLE_KEYS) {
    if (body[key] === undefined) continue;
    if (key === "clientType" && !CONSULTANCY_CLIENT_TYPES.includes(body.clientType as ConsultancyClientType)) continue;
    if (key === "consultancyCategory" && !CONSULTANCY_CATEGORIES.includes(body.consultancyCategory as ConsultancyCategory)) continue;
    if (key === "projectStatus" && body.projectStatus !== "ONGOING" && body.projectStatus !== "COMPLETED") continue;
    if (key === "deliverables") {
      updates.deliverables = (body.deliverables ?? []).filter((d) => CONSULTANCY_DELIVERABLES.includes(d));
      continue;
    }
    updates[key] = body[key];
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

    const body = (await request.json()) as ConsultancyProjectPatchBody;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("consultancyProjects").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Consultancy project not found" }, { status: 404 });
    }
    const project = snap.data() as { uid: string; title: string; status?: PublicationStatus };
    const isRnD = session.role === "R_AND_D";
    const isOwner = project.uid === session.uid;
    if (!isRnD && !isOwner) {
      return NextResponse.json({ error: "Not authorized to edit this consultancy project" }, { status: 403 });
    }

    // Consultant names are re-resolved from the submitted Faculty IDs. Only
    // touched when the client sent IDs, so a record that still carries older
    // free-text names isn't blanked by an edit that never mentions consultants.
    let consultantFields: Record<string, unknown> = {};
    if (!body.decision && body.facultyConsultantIds !== undefined) {
      const consultants = await finalizeFacultyConsultants(db, session.collegeId, body.facultyConsultantIds);
      if ("error" in consultants) return NextResponse.json({ error: consultants.error }, { status: 400 });
      consultantFields = consultants.fields;
    }

    // R&D's verification decision - approve/reject a self-submitted record.
    if (body.decision) {
      if (!isRnD) {
        return NextResponse.json({ error: "Only R&D can verify a consultancy project" }, { status: 403 });
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
        action: "RD_CONSULTANCY_PROJECT_UPDATED",
        performedBy: session.uid,
        performedByName: reviewedByName,
        targetId: id,
        details: { title: project.title, decision: body.decision },
        timestamp: now,
      });

      await notify(
        db, session.collegeId, project.uid,
        "CONSULTANCY_PROJECT_REVIEWED",
        body.decision === "APPROVED" ? "Consultancy project approved" : "Consultancy project rejected",
        body.decision === "APPROVED"
          ? `"${project.title}" was verified and now shows as an official record`
          : `"${project.title}" was rejected${body.rejectionReason ? `: ${body.rejectionReason}` : ""} - you can edit and resubmit it`
      );

      return NextResponse.json({ ok: true });
    }

    // Owner editing+resubmitting their own rejected submission.
    if (isOwner && !isRnD) {
      if (!isResubmittable(project.status)) {
        return NextResponse.json({ error: "Only a rejected or sent-back submission can be edited" }, { status: 403 });
      }
      // The owner resubmits the whole form, so the same compulsory-sections rule
      // as a fresh submission applies to what they send.
      const consultantCount = (consultantFields.facultyConsultants as unknown[] | undefined)?.length ?? 0;
      const validationError = validateConsultancyBody(
        { ...body, deliverables: pickEditableFields(body).deliverables as string[] | undefined },
        consultantCount
      );
      if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

      const route = await resolveSubmissionRoute(db, session.collegeId, session.uid, false);
      const now = new Date();
      const updates: Record<string, unknown> = {
        ...routeFields(route),
        sentBackReason: FieldValue.delete(),
        coordinatorNote: FieldValue.delete(),
        ...pickEditableFields(body),
        ...consultantFields,
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
        action: "RD_CONSULTANCY_PROJECT_UPDATED",
        performedBy: session.uid,
        performedByName: editorName,
        targetId: id,
        details: { title: body.title ?? project.title },
        timestamp: now,
      });
      await notifyReviewer(db, session.collegeId, route, {
        type: "CONSULTANCY_PROJECT_PENDING_VERIFICATION", title: "Consultancy project resubmitted for verification",
        message: `A previously rejected consultancy project ("${body.title ?? project.title}") was corrected and resubmitted`,
        rndLink: "/r-and-d/consultancy-projects",
      });
      return NextResponse.json({ ok: true });
    }

    // R&D's own full edit - any field, any status.
    await ref.update({ ...pickEditableFields(body), ...consultantFields, updatedAt: new Date() });
    let actorName = "Unknown";
    try {
      const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    } catch { /* best-effort */ }
    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "RD_CONSULTANCY_PROJECT_UPDATED",
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
    console.error("[college/consultancy-projects/[id] PATCH]", err);
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
    const ref = db.collection("colleges").doc(session.collegeId).collection("consultancyProjects").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Consultancy project not found" }, { status: 404 });
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
      action: "RD_CONSULTANCY_PROJECT_DELETED",
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
    console.error("[college/consultancy-projects/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
