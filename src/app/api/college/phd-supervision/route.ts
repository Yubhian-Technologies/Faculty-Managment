export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notifyRole } from "@/lib/notify";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import { resolveOwnerDesignation } from "@/lib/publications/resolveOwnerDesignation";
import type {
  PhdAwardNature, PhdAwardType, PhdFellowshipType, PhdGuideStatus, PhdRecognizedSupervisor,
  PublicationStatus, SeedFundingPaperItem, SeedFundingPatentItem, UserRole,
} from "@/types";

const COLLEGE_STAFF_ROLES = PUBLICATION_ELIGIBLE_ROLES;

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const { searchParams } = new URL(request.url);

    const db = getAdminDb();
    const coll = db.collection("colleges").doc(session.collegeId).collection("phdSupervisions");

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
    console.error("[college/phd-supervision GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface PhdSupervisionBody {
  uid?: string;
  recognizedSupervisor?: PhdRecognizedSupervisor;
  otherUniversityName?: string;
  guideStatus?: PhdGuideStatus;
  scholarName?: string;
  scholarDepartment?: string;
  scholarAffiliation?: string;
  scholarPhone?: string;
  yearOfAllocation?: string;
  allotmentOrderUrl?: string;
  yearsCompleted?: number;
  degreeAwarded?: "YES" | "NO";
  dateOfAward?: string;
  awardedDegreeProofUrl?: string;
  papersPublished?: SeedFundingPaperItem[];
  patents?: SeedFundingPatentItem[];
  fellowshipReceived?: "YES" | "NO";
  fellowshipType?: PhdFellowshipType;
  fellowshipName?: string;
  fellowshipAmount?: number;
  awardsReceived?: "YES" | "NO";
  awardName?: string;
  awardType?: PhdAwardType;
  awardNature?: PhdAwardNature;
  awardDetails?: string;
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const isRnD = session.role === "R_AND_D";

    const body = (await request.json()) as PhdSupervisionBody;
    const uid = isRnD ? body.uid : session.uid;
    const { recognizedSupervisor, guideStatus, scholarName } = body;

    if (!uid || !recognizedSupervisor || !guideStatus || !scholarName) {
      return NextResponse.json(
        { error: "uid, recognizedSupervisor, guideStatus and scholarName are required" },
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
      return NextResponse.json({ error: "Ph.D. supervision records can only be recorded for staff, not students" }, { status: 400 });
    }

    let addedByName = "R&D";
    try {
      const addedBySnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      addedByName = (addedBySnap.data() as { name?: string } | undefined)?.name ?? (isRnD ? "R&D" : "Unknown");
    } catch { /* best-effort */ }

    const ownerDesignation = await resolveOwnerDesignation(db, session.collegeId, uid, owner.role);

    const now = new Date();
    const docRef = await db.collection("colleges").doc(session.collegeId).collection("phdSupervisions").add({
      collegeId: session.collegeId,
      uid,
      ownerName: owner.name ?? "Unknown",
      ownerRole: owner.role,
      ...(ownerDesignation ? { ownerDesignation } : {}),
      status: (isRnD ? "APPROVED" : "PENDING") satisfies PublicationStatus,
      recognizedSupervisor,
      otherUniversityName: body.otherUniversityName ?? "",
      guideStatus,
      scholarName,
      scholarDepartment: body.scholarDepartment ?? "",
      scholarAffiliation: body.scholarAffiliation ?? "",
      scholarPhone: body.scholarPhone ?? "",
      yearOfAllocation: body.yearOfAllocation ?? "",
      allotmentOrderUrl: body.allotmentOrderUrl ?? "",
      yearsCompleted: body.yearsCompleted ?? null,
      degreeAwarded: body.degreeAwarded ?? null,
      dateOfAward: body.dateOfAward ?? "",
      awardedDegreeProofUrl: body.awardedDegreeProofUrl ?? "",
      papersPublished: body.papersPublished ?? [],
      patents: body.patents ?? [],
      fellowshipReceived: body.fellowshipReceived ?? null,
      fellowshipType: body.fellowshipType ?? null,
      fellowshipName: body.fellowshipName ?? "",
      fellowshipAmount: body.fellowshipAmount ?? null,
      awardsReceived: body.awardsReceived ?? null,
      awardName: body.awardName ?? "",
      awardType: body.awardType ?? null,
      awardNature: body.awardNature ?? null,
      awardDetails: body.awardDetails ?? "",
      addedBy: session.uid,
      addedByName,
      createdAt: now,
      updatedAt: now,
    });

    if (!isRnD) {
      await notifyRole(
        db, session.collegeId, "R_AND_D",
        "PHD_SUPERVISION_PENDING_VERIFICATION",
        "New Ph.D. supervision record submitted for verification",
        `${owner.name ?? "A staff member"} submitted a supervision record for "${scholarName}" for verification`,
        "/r-and-d/phd-supervision"
      );
    }

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/phd-supervision POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
