export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify, notifyRole } from "@/lib/notify";
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
  facultyConsultantsCount?: number;
  facultyConsultantsNames?: string;
  department?: string;
  clientName?: string;
  clientType?: ConsultancyClientType;
  consultancyCategory?: ConsultancyCategory;
  problemStatement?: string;
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
  "title", "facultyConsultantsCount", "facultyConsultantsNames", "department",
  "clientName", "clientType", "consultancyCategory", "problemStatement",
  "startDate", "endDate", "durationMonths", "consultancyAmount", "amountReceived",
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
      if (project.status !== "REJECTED") {
        return NextResponse.json({ error: "Only a rejected submission can be edited" }, { status: 403 });
      }
      const now = new Date();
      const updates: Record<string, unknown> = {
        ...pickEditableFields(body),
        updatedAt: now,
        status: "PENDING" satisfies PublicationStatus,
        reviewedBy: FieldValue.delete(),
        reviewedByName: FieldValue.delete(),
        reviewedAt: FieldValue.delete(),
        rejectionReason: FieldValue.delete(),
      };

      await ref.update(updates);
      await notifyRole(
        db, session.collegeId, "R_AND_D",
        "CONSULTANCY_PROJECT_PENDING_VERIFICATION",
        "Consultancy project resubmitted for verification",
        `A previously rejected consultancy project ("${body.title ?? project.title}") was corrected and resubmitted`,
        "/r-and-d/consultancy-projects"
      );
      return NextResponse.json({ ok: true });
    }

    // R&D's own full edit - any field, any status.
    await ref.update({ ...pickEditableFields(body), updatedAt: new Date() });
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

    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/consultancy-projects/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
