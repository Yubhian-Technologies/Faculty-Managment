export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notifyRole } from "@/lib/notify";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import { resolveOwnerDesignation } from "@/lib/publications/resolveOwnerDesignation";
import type {
  PublicationStatus, SeedFundingEquipmentItem, SeedFundingPaperItem,
  SeedFundingPatentItem, SeedFundingProjectStatus, SeedFundingStudentItem, UserRole,
} from "@/types";

const COLLEGE_STAFF_ROLES = PUBLICATION_ELIGIBLE_ROLES;

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const { searchParams } = new URL(request.url);

    const db = getAdminDb();
    const coll = db.collection("colleges").doc(session.collegeId).collection("seedFundingProjects");

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
    console.error("[college/seed-funding GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface SeedFundingBody {
  uid?: string;
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
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const isRnD = session.role === "R_AND_D";

    const body = (await request.json()) as SeedFundingBody;
    const uid = isRnD ? body.uid : session.uid;
    const { title, objectives, piName } = body;
    const projectStatus = body.projectStatus === "SANCTIONED" || body.projectStatus === "COMPLETED" ? body.projectStatus : undefined;

    if (!uid || !title || !objectives || !piName || !projectStatus) {
      return NextResponse.json(
        { error: "uid, title, objectives, piName and projectStatus are required" },
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
      return NextResponse.json({ error: "Seed funding projects can only be recorded for staff, not students" }, { status: 400 });
    }

    let addedByName = "R&D";
    try {
      const addedBySnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      addedByName = (addedBySnap.data() as { name?: string } | undefined)?.name ?? (isRnD ? "R&D" : "Unknown");
    } catch { /* best-effort */ }

    const ownerDesignation = await resolveOwnerDesignation(db, session.collegeId, uid, owner.role);

    const now = new Date();
    const docRef = await db.collection("colleges").doc(session.collegeId).collection("seedFundingProjects").add({
      collegeId: session.collegeId,
      uid,
      ownerName: owner.name ?? "Unknown",
      ownerRole: owner.role,
      ...(ownerDesignation ? { ownerDesignation } : {}),
      status: (isRnD ? "APPROVED" : "PENDING") satisfies PublicationStatus,
      title,
      durationMonths: body.durationMonths ?? null,
      objectives,
      tentativeOutcomes: body.tentativeOutcomes ?? "",
      piName,
      piDepartment: body.piDepartment ?? "",
      studentsInvolvedCount: body.studentsInvolvedCount ?? null,
      students: body.students ?? [],
      projectStatus,
      dateSanctioned: body.dateSanctioned ?? "",
      dateOfStart: body.dateOfStart ?? "",
      financialYearOfStart: body.financialYearOfStart ?? "",
      totalAmountSanctioned: body.totalAmountSanctioned ?? null,
      recurringAmount: body.recurringAmount ?? null,
      nonRecurringAmount: body.nonRecurringAmount ?? null,
      equipmentProcured: body.equipmentProcured ?? [],
      outcomes: body.outcomes ?? "",
      papersPublished: body.papersPublished ?? [],
      patents: body.patents ?? [],
      studentsProjectsUG: body.studentsProjectsUG ?? null,
      studentsProjectsPG: body.studentsProjectsPG ?? null,
      studentsProjectsPhD: body.studentsProjectsPhD ?? null,
      studentsTrainedCount: body.studentsTrainedCount ?? null,
      externalFundedProposalsApplied: body.externalFundedProposalsApplied ?? null,
      progressReportUrl: body.progressReportUrl ?? "",
      utilizationCertificateUrl: body.utilizationCertificateUrl ?? "",
      addedBy: session.uid,
      addedByName,
      createdAt: now,
      updatedAt: now,
    });

    if (!isRnD) {
      await notifyRole(
        db, session.collegeId, "R_AND_D",
        "SEED_FUNDING_PENDING_VERIFICATION",
        "New seed funding project submitted for verification",
        `${owner.name ?? "A staff member"} submitted "${title}" for verification`,
        "/r-and-d/seed-funding"
      );
    }

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/seed-funding POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
