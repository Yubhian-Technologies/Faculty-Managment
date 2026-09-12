export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notifyRole } from "@/lib/notify";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import { resolveOwnerDesignation } from "@/lib/publications/resolveOwnerDesignation";
import type {
  ConferenceWorkshopNature, ConferenceWorkshopType, ConvenerCoordinatorItem, EditorPublicationType,
  EditorialRole, OrganizingCommitteeMemberItem, PublicationScope, PublicationStatus, ResearchServiceFundNature,
  ResearchServiceType, ResourcePersonItem, ReviewerType, UserRole,
} from "@/types";

const COLLEGE_STAFF_ROLES = PUBLICATION_ELIGIBLE_ROLES;

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const { searchParams } = new URL(request.url);

    const db = getAdminDb();
    const coll = db.collection("colleges").doc(session.collegeId).collection("researchServices");

    let query: FirebaseFirestore.Query = coll;
    if (session.role === "R_AND_D") {
      const uidFilter = searchParams.get("uid");
      if (uidFilter) query = query.where("uid", "==", uidFilter);
    } else {
      query = query.where("uid", "==", session.uid);
    }

    const snap = await query.get();
    const records = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const aTime = (a as { createdAt?: { toMillis?: () => number } }).createdAt?.toMillis?.() ?? 0;
        const bTime = (b as { createdAt?: { toMillis?: () => number } }).createdAt?.toMillis?.() ?? 0;
        return bTime - aTime;
      });

    return NextResponse.json({ records });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/research-services GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface ResearchServiceBody {
  uid?: string;
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
}

const SCALAR_KEYS = [
  "organized", "eventType", "eventNature", "fundNature", "title", "convenersCount",
  "committeeMembersCount", "noOfDays", "academicYear", "startDate", "endDate",
  "amountSanctioned", "amountReceived", "expenditureMade", "sanctionedLetterUrl", "brochureUrl", "scheduleUrl",
  "resourcePersonsCount", "completionReportUrl", "papersReceived", "papersAccepted",
  "papersPublishedCount", "papersIndexedCount", "conferenceProceedingsUrl", "participantsRegisteredInternal",
  "participantsRegisteredExternal", "papersAttendedInternal", "papersAttendedExternal", "reviewerType",
  "reviewerPublicationName", "reviewerPublisherName", "reviewerPaperTitle", "reviewerReviewDate",
  "reviewerCertificateUrl", "editorialRole", "editorPublicationType", "editorPublicationName", "editorPublisher",
  "editorPublisherOther", "editorIssnIsbn", "editorScope", "editorIndexedIn", "editorResponsibilities",
  "editorPapersChaptersHandled", "editorAppointmentLetterUrl", "editorPublicationUrl", "editorRemarks",
] as const satisfies readonly (keyof ResearchServiceBody)[];

function buildFieldUpdates(body: ResearchServiceBody): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const key of SCALAR_KEYS) {
    updates[key] = body[key] ?? null;
  }
  updates.conveners = body.conveners ?? [];
  updates.committeeMembers = body.committeeMembers ?? [];
  updates.resourcePersons = body.resourcePersons ?? [];
  return updates;
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const isRnD = session.role === "R_AND_D";

    const body = (await request.json()) as ResearchServiceBody;
    const uid = isRnD ? body.uid : session.uid;
    const { serviceType } = body;

    if (!uid || !serviceType) {
      return NextResponse.json({ error: "uid and serviceType are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const ownerSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(uid).get();
    if (!ownerSnap.exists) {
      return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    }
    const owner = ownerSnap.data() as { name?: string; role?: UserRole };
    if (!owner.role || !PUBLICATION_ELIGIBLE_ROLES.includes(owner.role)) {
      return NextResponse.json({ error: "Research service records can only be recorded for staff, not students" }, { status: 400 });
    }

    let addedByName = "R&D";
    try {
      const addedBySnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      addedByName = (addedBySnap.data() as { name?: string } | undefined)?.name ?? (isRnD ? "R&D" : "Unknown");
    } catch { /* best-effort */ }

    const ownerDesignation = await resolveOwnerDesignation(db, session.collegeId, uid, owner.role);

    const now = new Date();
    const docRef = await db.collection("colleges").doc(session.collegeId).collection("researchServices").add({
      collegeId: session.collegeId,
      uid,
      ownerName: owner.name ?? "Unknown",
      ownerRole: owner.role,
      ...(ownerDesignation ? { ownerDesignation } : {}),
      status: (isRnD ? "APPROVED" : "PENDING") satisfies PublicationStatus,
      serviceType,
      ...buildFieldUpdates(body),
      addedBy: session.uid,
      addedByName,
      createdAt: now,
      updatedAt: now,
    });

    if (!isRnD) {
      await notifyRole(
        db, session.collegeId, "R_AND_D",
        "RESEARCH_SERVICE_PENDING_VERIFICATION",
        "New research service record submitted for verification",
        `${owner.name ?? "A staff member"} submitted a ${serviceType.toLowerCase()} record for verification`,
        "/r-and-d/research-services"
      );
    }

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/research-services POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
