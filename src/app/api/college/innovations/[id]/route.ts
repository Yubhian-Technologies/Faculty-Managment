export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import { isResubmittable, notifyReviewer, resolveSubmissionRoute, routeFields } from "@/lib/research/coordinatorReview";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import type {
  InnovationFacultyItem, InnovationType, InnovatorType, PublicationStatus,
} from "@/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("R_AND_D");
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("innovations").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Innovation record not found" }, { status: 404 });
    }

    return NextResponse.json({ record: { id: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/innovations/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface InnovationPatchBody {
  academicYear?: string;
  innovatorType?: InnovatorType;
  facultyInvolvedCount?: number;
  facultyMembers?: InnovationFacultyItem[];
  studentName?: string;
  studentRegdNo?: string;
  studentYearOfStudy?: string;
  studentDepartment?: string;
  facultyMentorName?: string;
  innovationTitle?: string;
  innovationType?: InnovationType;
  problemStatement?: string;
  briefDescription?: string;
  trlLevel?: string;
  prototypeDeveloped?: "YES" | "NO";
  prototypeDetails?: string;
  businessModelDeveloped?: "YES" | "NO";
  businessModelDetails?: string;
  startupFormed?: "YES" | "NO";
  startupName?: string;
  incubationName?: string;
  yuktiId?: string;
  verifiedRecommendedYukti?: "YES" | "NO";
  yuktiScreenshotUrl?: string;
  presentedInCompetition?: "YES" | "NO";
  competitionName?: string;
  organizedBy?: string;
  remarks?: string;
  decision?: "APPROVED" | "REJECTED";
  rejectionReason?: string;
}

const EDITABLE_KEYS = [
  "academicYear", "innovatorType", "facultyInvolvedCount", "facultyMembers", "studentName", "studentRegdNo",
  "studentYearOfStudy", "studentDepartment", "facultyMentorName", "innovationTitle", "innovationType",
  "problemStatement", "briefDescription", "trlLevel", "prototypeDeveloped", "prototypeDetails",
  "businessModelDeveloped", "businessModelDetails", "startupFormed", "startupName", "incubationName", "yuktiId",
  "verifiedRecommendedYukti", "yuktiScreenshotUrl", "presentedInCompetition", "competitionName", "organizedBy",
  "remarks",
] as const satisfies readonly (keyof InnovationPatchBody)[];

function pickEditableFields(body: InnovationPatchBody): Record<string, unknown> {
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

    const body = (await request.json()) as InnovationPatchBody;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("innovations").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Innovation record not found" }, { status: 404 });
    }
    const record = snap.data() as { uid: string; innovationTitle: string; status?: PublicationStatus };
    const isRnD = session.role === "R_AND_D";
    const isOwner = record.uid === session.uid;
    if (!isRnD && !isOwner) {
      return NextResponse.json({ error: "Not authorized to edit this record" }, { status: 403 });
    }

    if (body.decision) {
      if (!isRnD) {
        return NextResponse.json({ error: "Only R&D can verify an innovation record" }, { status: 403 });
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
        action: "RD_INNOVATION_UPDATED",
        performedBy: session.uid,
        performedByName: reviewedByName,
        targetId: id,
        details: { title: record.innovationTitle, decision: body.decision },
        timestamp: now,
      });

      await notify(
        db, session.collegeId, record.uid,
        "INNOVATION_REVIEWED",
        body.decision === "APPROVED" ? "Innovation record approved" : "Innovation record rejected",
        body.decision === "APPROVED"
          ? `"${record.innovationTitle}" was verified and now shows as an official record`
          : `"${record.innovationTitle}" was rejected${body.rejectionReason ? `: ${body.rejectionReason}` : ""} - you can edit and resubmit it`
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
        action: "RD_INNOVATION_UPDATED",
        performedBy: session.uid,
        performedByName: editorName,
        targetId: id,
        details: { title: body.innovationTitle ?? record.innovationTitle },
        timestamp: now,
      });
      await notifyReviewer(db, session.collegeId, route, {
        type: "INNOVATION_PENDING_VERIFICATION", title: "Innovation record resubmitted for verification",
        message: `A previously rejected innovation record ("${body.innovationTitle ?? record.innovationTitle}") was corrected and resubmitted`,
        rndLink: "/r-and-d/innovations",
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
      action: "RD_INNOVATION_UPDATED",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: id,
      details: { title: record.innovationTitle },
      timestamp: new Date(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/innovations/[id] PATCH]", err);
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
    const ref = db.collection("colleges").doc(session.collegeId).collection("innovations").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Innovation record not found" }, { status: 404 });
    }
    const record = snap.data() as { innovationTitle?: string; uid?: string };

    await ref.delete();
    let actorName = "Unknown";
    try {
      const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    } catch { /* best-effort */ }
    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "RD_INNOVATION_DELETED",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: id,
      details: { title: record.innovationTitle, uid: record.uid },
      timestamp: new Date(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/innovations/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
