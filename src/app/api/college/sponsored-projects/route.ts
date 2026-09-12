export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notifyRole } from "@/lib/notify";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import { resolveOwnerDesignation } from "@/lib/publications/resolveOwnerDesignation";
import type {
  PublicationStatus, SeedFundingEquipmentItem, SeedFundingPaperItem, SeedFundingPatentItem,
  SponsoredProjectCoPI, SponsoredProjectSanctionedStatus, SponsoredProjectStatus, SponsoredProjectType, UserRole,
} from "@/types";

const COLLEGE_STAFF_ROLES = PUBLICATION_ELIGIBLE_ROLES;

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const { searchParams } = new URL(request.url);

    const db = getAdminDb();
    const coll = db.collection("colleges").doc(session.collegeId).collection("sponsoredProjects");

    let query: FirebaseFirestore.Query = coll;
    if (session.role === "R_AND_D") {
      const uidFilter = searchParams.get("uid");
      if (uidFilter) query = query.where("uid", "==", uidFilter);
    } else {
      query = query.where("uid", "==", session.uid);
    }

    const snap = await query.get();
    const projects = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const aTime = (a as { createdAt?: { toMillis?: () => number } }).createdAt?.toMillis?.() ?? 0;
        const bTime = (b as { createdAt?: { toMillis?: () => number } }).createdAt?.toMillis?.() ?? 0;
        return bTime - aTime;
      });

    return NextResponse.json({ projects });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/sponsored-projects GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface SponsoredProjectBody {
  uid?: string;
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
  sanctionedStatus?: SponsoredProjectSanctionedStatus;
  dateProjectSanctioned?: string;
  dateOfStart?: string;
  financialYearOfStart?: string;
  totalAmountSanctioned?: number;
  recurringAmountSanctioned?: number;
  nonRecurringAmountSanctioned?: number;
  instituteContributionSanctioned?: number;
  noOfYears?: string;
  totalAmountReceived?: number;
  recurringAmountReceived?: number;
  nonRecurringAmountReceived?: number;
  instituteContributionReceived?: number;
  dateOfCompletion?: string;
  financialYearOfCompletion?: string;
  infrastructureProcured?: SeedFundingEquipmentItem[];
  outcomes?: string;
  papersPublished?: SeedFundingPaperItem[];
  papersPublishedCitations?: string;
  patents?: SeedFundingPatentItem[];
  studentsProjectsUG?: number;
  studentsProjectsPG?: number;
  studentsProjectsPhD?: number;
  studentsTrainedCount?: number;
  technicalStaffTrainedCount?: number;
  personsTrainedCount?: number;
  progressReportUrl?: string;
  completionReportUrl?: string;
  utilizationCertificateUrl?: string;
  statementOfExpenditureUrl?: string;
  submittedRequiredDocs?: "YES" | "NO";
  dateOfSubmission?: string;
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const isRnD = session.role === "R_AND_D";

    const body = (await request.json()) as SponsoredProjectBody;
    const uid = isRnD ? body.uid : session.uid;
    const { agencyName, schemeName, applicationNumber, title, projectType, objectives, piName, projectStatus } = body;

    if (!uid || !agencyName || !schemeName || !applicationNumber || !title || !projectType || !objectives || !piName || !projectStatus) {
      return NextResponse.json(
        { error: "uid, agencyName, schemeName, applicationNumber, title, projectType, objectives, piName and projectStatus are required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const ownerSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(uid).get();
    if (!ownerSnap.exists) {
      return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    }
    const owner = ownerSnap.data() as { name?: string; role?: UserRole };
    if (!owner.role || !PUBLICATION_ELIGIBLE_ROLES.includes(owner.role)) {
      return NextResponse.json({ error: "Sponsored projects can only be recorded for staff, not students" }, { status: 400 });
    }

    let addedByName = "R&D";
    try {
      const addedBySnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      addedByName = (addedBySnap.data() as { name?: string } | undefined)?.name ?? (isRnD ? "R&D" : "Unknown");
    } catch { /* best-effort */ }

    const ownerDesignation = await resolveOwnerDesignation(db, session.collegeId, uid, owner.role);

    const now = new Date();
    const docRef = await db.collection("colleges").doc(session.collegeId).collection("sponsoredProjects").add({
      collegeId: session.collegeId,
      uid,
      ownerName: owner.name ?? "Unknown",
      ownerRole: owner.role,
      ...(ownerDesignation ? { ownerDesignation } : {}),
      status: (isRnD ? "APPROVED" : "PENDING") satisfies PublicationStatus,
      agencyName,
      schemeName,
      applicationNumber,
      title,
      projectType,
      durationMonths: body.durationMonths ?? null,
      objectives,
      tentativeOutcomes: body.tentativeOutcomes ?? "",
      piName,
      piDepartment: body.piDepartment ?? "",
      piAffiliation: body.piAffiliation ?? "",
      coPiCount: body.coPiCount ?? null,
      coPis: body.coPis ?? [],
      projectStatus,
      dateProposalSubmitted: body.dateProposalSubmitted ?? "",
      amountApplied: body.amountApplied ?? null,
      extendedToSeedFund: body.extendedToSeedFund ?? null,
      sanctionedStatus: body.sanctionedStatus ?? null,
      dateProjectSanctioned: body.dateProjectSanctioned ?? "",
      dateOfStart: body.dateOfStart ?? "",
      financialYearOfStart: body.financialYearOfStart ?? "",
      totalAmountSanctioned: body.totalAmountSanctioned ?? null,
      recurringAmountSanctioned: body.recurringAmountSanctioned ?? null,
      nonRecurringAmountSanctioned: body.nonRecurringAmountSanctioned ?? null,
      instituteContributionSanctioned: body.instituteContributionSanctioned ?? null,
      noOfYears: body.noOfYears ?? "",
      totalAmountReceived: body.totalAmountReceived ?? null,
      recurringAmountReceived: body.recurringAmountReceived ?? null,
      nonRecurringAmountReceived: body.nonRecurringAmountReceived ?? null,
      instituteContributionReceived: body.instituteContributionReceived ?? null,
      dateOfCompletion: body.dateOfCompletion ?? "",
      financialYearOfCompletion: body.financialYearOfCompletion ?? "",
      infrastructureProcured: body.infrastructureProcured ?? [],
      outcomes: body.outcomes ?? "",
      papersPublished: body.papersPublished ?? [],
      papersPublishedCitations: body.papersPublishedCitations ?? "",
      patents: body.patents ?? [],
      studentsProjectsUG: body.studentsProjectsUG ?? null,
      studentsProjectsPG: body.studentsProjectsPG ?? null,
      studentsProjectsPhD: body.studentsProjectsPhD ?? null,
      studentsTrainedCount: body.studentsTrainedCount ?? null,
      technicalStaffTrainedCount: body.technicalStaffTrainedCount ?? null,
      personsTrainedCount: body.personsTrainedCount ?? null,
      progressReportUrl: body.progressReportUrl ?? "",
      completionReportUrl: body.completionReportUrl ?? "",
      utilizationCertificateUrl: body.utilizationCertificateUrl ?? "",
      statementOfExpenditureUrl: body.statementOfExpenditureUrl ?? "",
      submittedRequiredDocs: body.submittedRequiredDocs ?? null,
      dateOfSubmission: body.dateOfSubmission ?? "",
      addedBy: session.uid,
      addedByName,
      createdAt: now,
      updatedAt: now,
    });

    if (!isRnD) {
      await notifyRole(
        db, session.collegeId, "R_AND_D",
        "SPONSORED_PROJECT_PENDING_VERIFICATION",
        "New sponsored research project submitted for verification",
        `${owner.name ?? "A staff member"} submitted "${title}" for verification`,
        "/r-and-d/sponsored-projects"
      );
    }

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/sponsored-projects POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
