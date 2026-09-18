export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify, notifyRole } from "@/lib/notify";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import type {
  HackathonEvaluatorItem, HackathonEventType, HackathonFacultyCoordinatorItem, HackathonLevel,
  PublicationStatus, YuktiReferenceItem,
} from "@/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("R_AND_D");
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("hackathons").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    return NextResponse.json({ record: { id: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/hackathons/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface HackathonPatchBody {
  academicYear?: string;
  eventTitle?: string;
  eventType?: HackathonEventType;
  organizingDeptCell?: string;
  startDate?: string;
  endDate?: string;
  durationHours?: number;
  venue?: string;
  levelOfEvent?: HackathonLevel;
  themeDomain?: string;
  noOfProblemStatements?: number;
  teamsRegisteredInternal?: number;
  teamsRegisteredExternal?: number;
  participantsInternal?: number;
  participantsExternal?: number;
  ideasPresentedCount?: number;
  pocsPresentedCount?: number;
  productsPresentedCount?: number;
  evaluators?: HackathonEvaluatorItem[];
  facultyCoordinators?: HackathonFacultyCoordinatorItem[];
  ideasUploadedYukti?: number;
  ideasVerifiedRecommendedYukti?: number;
  prototypesUploadedYukti?: number;
  prototypesVerifiedRecommendedYukti?: number;
  yuktiReferences?: YuktiReferenceItem[];
  sanctionedLetterUrl?: string;
  brochureUrl?: string;
  expenditureProofUrl?: string;
  eventReportUrl?: string;
  remarks?: string;
  decision?: "APPROVED" | "REJECTED";
  rejectionReason?: string;
}

const EDITABLE_KEYS = [
  "academicYear", "eventTitle", "eventType", "organizingDeptCell", "startDate", "endDate", "durationHours",
  "venue", "levelOfEvent", "themeDomain", "noOfProblemStatements", "teamsRegisteredInternal",
  "teamsRegisteredExternal", "participantsInternal", "participantsExternal", "ideasPresentedCount",
  "pocsPresentedCount", "productsPresentedCount", "evaluators", "facultyCoordinators", "ideasUploadedYukti",
  "ideasVerifiedRecommendedYukti", "prototypesUploadedYukti", "prototypesVerifiedRecommendedYukti",
  "yuktiReferences", "sanctionedLetterUrl", "brochureUrl", "expenditureProofUrl", "eventReportUrl", "remarks",
] as const satisfies readonly (keyof HackathonPatchBody)[];

function pickEditableFields(body: HackathonPatchBody): Record<string, unknown> {
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

    const body = (await request.json()) as HackathonPatchBody;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("hackathons").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    const record = snap.data() as { uid: string; eventTitle: string; status?: PublicationStatus };
    const isRnD = session.role === "R_AND_D";
    const isOwner = record.uid === session.uid;
    if (!isRnD && !isOwner) {
      return NextResponse.json({ error: "Not authorized to edit this record" }, { status: 403 });
    }

    if (body.decision) {
      if (!isRnD) {
        return NextResponse.json({ error: "Only R&D can verify a hackathon record" }, { status: 403 });
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
        db, session.collegeId, record.uid,
        "HACKATHON_REVIEWED",
        body.decision === "APPROVED" ? "Hackathon record approved" : "Hackathon record rejected",
        body.decision === "APPROVED"
          ? `"${record.eventTitle}" was verified and now shows as an official record`
          : `"${record.eventTitle}" was rejected${body.rejectionReason ? `: ${body.rejectionReason}` : ""} - you can edit and resubmit it`
      );

      return NextResponse.json({ ok: true });
    }

    if (isOwner && !isRnD) {
      if (record.status !== "REJECTED") {
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
        "HACKATHON_PENDING_VERIFICATION",
        "Hackathon record resubmitted for verification",
        `A previously rejected record ("${body.eventTitle ?? record.eventTitle}") was corrected and resubmitted`,
        "/r-and-d/hackathons"
      );
      return NextResponse.json({ ok: true });
    }

    await ref.update({ ...pickEditableFields(body), updatedAt: new Date() });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/hackathons/[id] PATCH]", err);
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
    const ref = db.collection("colleges").doc(session.collegeId).collection("hackathons").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/hackathons/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
