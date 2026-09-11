export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify, notifyRole } from "@/lib/notify";
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
  outcomes?: string;
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
  "equipmentProcured", "outcomes", "papersPublished", "patents", "studentsProjectsUG",
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
        "SEED_FUNDING_PENDING_VERIFICATION",
        "Seed funding project resubmitted for verification",
        `A previously rejected seed funding project ("${body.title ?? project.title}") was corrected and resubmitted`,
        "/r-and-d/seed-funding"
      );
      return NextResponse.json({ ok: true });
    }

    await ref.update({ ...pickEditableFields(body), updatedAt: new Date() });
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

    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/seed-funding/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
