export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notifyRole } from "@/lib/notify";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import { resolveOwnerDesignation } from "@/lib/publications/resolveOwnerDesignation";
import { CONSULTANCY_CATEGORIES, CONSULTANCY_CLIENT_TYPES, CONSULTANCY_DELIVERABLES } from "@/lib/research/consultancyProjectOptions";
import type {
  ConsultancyCategory, ConsultancyClientType, ConsultancyDeliverable, PublicationStatus, UserRole,
} from "@/types";

// Same eligible-roles list as publications - only staff who can plausibly
// lead a consultancy project record.
const COLLEGE_STAFF_ROLES = PUBLICATION_ELIGIBLE_ROLES;

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const { searchParams } = new URL(request.url);

    const db = getAdminDb();
    const coll = db.collection("colleges").doc(session.collegeId).collection("consultancyProjects");

    // R&D manages every record (optionally drilling into one uid); everyone
    // else only ever sees their own.
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
    console.error("[college/consultancy-projects GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface ConsultancyProjectBody {
  uid?: string;
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
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const isRnD = session.role === "R_AND_D";

    const body = (await request.json()) as ConsultancyProjectBody;
    // Self-submission can only ever credit the submitter's own login - any
    // `uid` in the body is ignored for everyone except R&D, who is recording
    // it on someone else's behalf.
    const uid = isRnD ? body.uid : session.uid;
    const { title, clientName, problemStatement, startDate } = body;
    const clientType = body.clientType && CONSULTANCY_CLIENT_TYPES.includes(body.clientType) ? body.clientType : undefined;
    const consultancyCategory = body.consultancyCategory && CONSULTANCY_CATEGORIES.includes(body.consultancyCategory) ? body.consultancyCategory : undefined;
    const deliverables = (body.deliverables ?? []).filter((d) => CONSULTANCY_DELIVERABLES.includes(d));

    if (!uid || !title || !clientName || !clientType || !consultancyCategory || !problemStatement || !startDate) {
      return NextResponse.json(
        { error: "uid, title, clientName, clientType, consultancyCategory, problemStatement and startDate are required" },
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
      return NextResponse.json({ error: "Consultancy projects can only be recorded for staff, not students" }, { status: 400 });
    }

    let addedByName = "R&D";
    try {
      const addedBySnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      addedByName = (addedBySnap.data() as { name?: string } | undefined)?.name ?? (isRnD ? "R&D" : "Unknown");
    } catch { /* best-effort */ }

    const ownerDesignation = await resolveOwnerDesignation(db, session.collegeId, uid, owner.role);

    const now = new Date();
    const docRef = await db.collection("colleges").doc(session.collegeId).collection("consultancyProjects").add({
      collegeId: session.collegeId,
      uid,
      ownerName: owner.name ?? "Unknown",
      ownerRole: owner.role,
      ...(ownerDesignation ? { ownerDesignation } : {}),
      // R&D is the verifying authority itself - anything it adds directly is
      // already official. Everyone else's own submission needs R&D's review
      // before it counts as an official record.
      status: (isRnD ? "APPROVED" : "PENDING") satisfies PublicationStatus,
      title,
      facultyConsultantsCount: body.facultyConsultantsCount ?? null,
      facultyConsultantsNames: body.facultyConsultantsNames ?? "",
      department: body.department ?? "",
      clientName,
      clientType,
      consultancyCategory,
      problemStatement,
      startDate,
      endDate: body.endDate ?? "",
      durationMonths: body.durationMonths ?? null,
      consultancyAmount: body.consultancyAmount ?? null,
      amountReceived: body.amountReceived ?? null,
      amountReceivedDate: body.amountReceivedDate ?? "",
      institutionalInfrastructureUsage: body.institutionalInfrastructureUsage ?? null,
      hoursSpentDuringAcademicHours: body.hoursSpentDuringAcademicHours ?? null,
      institutionalShare: body.institutionalShare ?? null,
      facultyShare: body.facultyShare ?? null,
      facultyShareProofUrl: body.facultyShareProofUrl ?? "",
      deliverables,
      completionReportUrl: body.completionReportUrl ?? "",
      incomeSupportingDocUrl: body.incomeSupportingDocUrl ?? "",
      addedBy: session.uid,
      addedByName,
      createdAt: now,
      updatedAt: now,
    });

    if (!isRnD) {
      await notifyRole(
        db, session.collegeId, "R_AND_D",
        "CONSULTANCY_PROJECT_PENDING_VERIFICATION",
        "New consultancy project submitted for verification",
        `${owner.name ?? "A staff member"} submitted "${title}" for verification`,
        "/r-and-d/consultancy-projects"
      );
    }

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/consultancy-projects POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
