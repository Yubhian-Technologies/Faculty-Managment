export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { isVisibleToRnD, notifyReviewer, resolveSubmissionRoute, routeFields } from "@/lib/research/coordinatorReview";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import { resolveOwnerDesignation } from "@/lib/publications/resolveOwnerDesignation";
import { finalizeIprInventors } from "@/lib/research/finalizeIprInventors";
import { validateDiscoveryInnovationBody } from "@/lib/research/validateDiscoveryInnovation";
import type {
  IprApplicant, IprCommercializationStatus, IprCommercializationType, IprInventor, IprStatus, IprType,
  PublicationStatus, UserRole,
} from "@/types";

const COLLEGE_STAFF_ROLES = PUBLICATION_ELIGIBLE_ROLES;

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const { searchParams } = new URL(request.url);

    const db = getAdminDb();
    const coll = db.collection("colleges").doc(session.collegeId).collection("discoveryInnovations");

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
      .filter((r) => session.role !== "R_AND_D" || isVisibleToRnD((r as { status?: string }).status))
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
    console.error("[college/discovery-innovation GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface DiscoveryInnovationBody {
  uid?: string;
  iprType?: IprType;
  iprStatus?: IprStatus;
  applicationNumber?: string;
  title?: string;
  sdgGoals?: number[];
  dateOfFiling?: string;
  datePublished?: string;
  dateGranted?: string;
  applicantsCount?: number;
  applicants?: IprApplicant[];
  inventorsCount?: number;
  inventors?: IprInventor[];
  isStudentPatent?: "YES" | "NO";
  publishedProofUrl?: string;
  grantedProofUrl?: string;
  isCommercialized?: "YES" | "NO";
  commercializationStatus?: IprCommercializationStatus;
  commercializationDate?: string;
  licenseePartner?: string;
  commercializationType?: IprCommercializationType;
  commercializationValue?: number;
  revenueGenerated?: number;
  commercializedProofUrl?: string;
  revenueGeneratedProofUrl?: string;
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const isRnD = session.role === "R_AND_D";

    const body = (await request.json()) as DiscoveryInnovationBody;
    const uid = isRnD ? body.uid : session.uid;
    const { iprType, iprStatus, applicationNumber, title, dateOfFiling } = body;

    if (!uid || !iprType || !iprStatus || !applicationNumber || !title || !dateOfFiling) {
      return NextResponse.json(
        { error: "uid, iprType, iprStatus, applicationNumber, title and dateOfFiling are required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const inventors = await finalizeIprInventors(db, session.collegeId, body.inventors ?? []);
    const validationError = validateDiscoveryInnovationBody({ ...body, inventors }, iprStatus);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const ownerSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(uid).get();
    if (!ownerSnap.exists) {
      return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    }
    const owner = ownerSnap.data() as { name?: string; role?: UserRole };
    if (!owner.role || !PUBLICATION_ELIGIBLE_ROLES.includes(owner.role)) {
      return NextResponse.json({ error: "Discovery & Innovation records can only be recorded for staff, not students" }, { status: 400 });
    }

    let addedByName = "R&D";
    try {
      const addedBySnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      addedByName = (addedBySnap.data() as { name?: string } | undefined)?.name ?? (isRnD ? "R&D" : "Unknown");
    } catch { /* best-effort */ }

    const ownerDesignation = await resolveOwnerDesignation(db, session.collegeId, uid, owner.role);

    const route = await resolveSubmissionRoute(db, session.collegeId, uid, isRnD);
    const now = new Date();
    const docRef = await db.collection("colleges").doc(session.collegeId).collection("discoveryInnovations").add({
      collegeId: session.collegeId,
      uid,
      ownerName: owner.name ?? "Unknown",
      ownerRole: owner.role,
      ...(ownerDesignation ? { ownerDesignation } : {}),
      status: route.status satisfies PublicationStatus,
      ...routeFields(route),
      iprType,
      iprStatus,
      applicationNumber,
      title,
      sdgGoals: body.sdgGoals ?? [],
      dateOfFiling,
      datePublished: body.datePublished ?? "",
      dateGranted: body.dateGranted ?? "",
      applicantsCount: body.applicantsCount ?? null,
      applicants: body.applicants ?? [],
      inventorsCount: body.inventorsCount ?? null,
      inventors,
      isStudentPatent: body.isStudentPatent ?? null,
      publishedProofUrl: body.publishedProofUrl ?? "",
      grantedProofUrl: body.grantedProofUrl ?? "",
      isCommercialized: body.isCommercialized ?? null,
      commercializationStatus: body.commercializationStatus ?? null,
      commercializationDate: body.commercializationDate ?? "",
      licenseePartner: body.licenseePartner ?? "",
      commercializationType: body.commercializationType ?? null,
      commercializationValue: body.commercializationValue ?? null,
      revenueGenerated: body.revenueGenerated ?? null,
      commercializedProofUrl: body.commercializedProofUrl ?? "",
      revenueGeneratedProofUrl: body.revenueGeneratedProofUrl ?? "",
      addedBy: session.uid,
      addedByName,
      createdAt: now,
      updatedAt: now,
    });

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "RD_DISCOVERY_INNOVATION_CREATED",
      performedBy: session.uid,
      performedByName: addedByName,
      targetId: docRef.id,
      details: { title, uid },
      timestamp: now,
    });

    await notifyReviewer(db, session.collegeId, route, {
        type: "DISCOVERY_INNOVATION_PENDING_VERIFICATION", title: "New IPR record submitted for verification",
        message: `${owner.name ?? "A staff member"} submitted "${title}" for verification`,
        rndLink: "/r-and-d/discovery-innovation",
      });

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/discovery-innovation POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
