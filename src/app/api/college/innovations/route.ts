export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notifyRole } from "@/lib/notify";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import { resolveOwnerDesignation } from "@/lib/publications/resolveOwnerDesignation";
import type {
  InnovationFacultyItem, InnovationType, InnovatorType, PublicationStatus, UserRole,
} from "@/types";

const COLLEGE_STAFF_ROLES = PUBLICATION_ELIGIBLE_ROLES;

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const { searchParams } = new URL(request.url);

    const db = getAdminDb();
    const coll = db.collection("colleges").doc(session.collegeId).collection("innovations");

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
    console.error("[college/innovations GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface InnovationBody {
  uid?: string;
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
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const isRnD = session.role === "R_AND_D";

    const body = (await request.json()) as InnovationBody;
    const uid = isRnD ? body.uid : session.uid;
    const { academicYear, innovatorType, innovationTitle, innovationType } = body;

    if (!uid || !academicYear || !innovatorType || !innovationTitle || !innovationType) {
      return NextResponse.json(
        { error: "uid, academicYear, innovatorType, innovationTitle and innovationType are required" },
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
      return NextResponse.json({ error: "Innovation records can only be recorded for staff, not students" }, { status: 400 });
    }

    let addedByName = "R&D";
    try {
      const addedBySnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      addedByName = (addedBySnap.data() as { name?: string } | undefined)?.name ?? (isRnD ? "R&D" : "Unknown");
    } catch { /* best-effort */ }

    const ownerDesignation = await resolveOwnerDesignation(db, session.collegeId, uid, owner.role);

    const now = new Date();
    const docRef = await db.collection("colleges").doc(session.collegeId).collection("innovations").add({
      collegeId: session.collegeId,
      uid,
      ownerName: owner.name ?? "Unknown",
      ownerRole: owner.role,
      ...(ownerDesignation ? { ownerDesignation } : {}),
      status: (isRnD ? "APPROVED" : "PENDING") satisfies PublicationStatus,
      academicYear,
      innovatorType,
      facultyInvolvedCount: body.facultyInvolvedCount ?? null,
      facultyMembers: body.facultyMembers ?? [],
      studentName: body.studentName ?? "",
      studentRegdNo: body.studentRegdNo ?? "",
      studentYearOfStudy: body.studentYearOfStudy ?? "",
      studentDepartment: body.studentDepartment ?? "",
      facultyMentorName: body.facultyMentorName ?? "",
      innovationTitle,
      innovationType,
      problemStatement: body.problemStatement ?? "",
      briefDescription: body.briefDescription ?? "",
      trlLevel: body.trlLevel ?? "",
      prototypeDeveloped: body.prototypeDeveloped ?? null,
      prototypeDetails: body.prototypeDetails ?? "",
      businessModelDeveloped: body.businessModelDeveloped ?? null,
      businessModelDetails: body.businessModelDetails ?? "",
      startupFormed: body.startupFormed ?? null,
      startupName: body.startupName ?? "",
      incubationName: body.incubationName ?? "",
      yuktiId: body.yuktiId ?? "",
      verifiedRecommendedYukti: body.verifiedRecommendedYukti ?? null,
      yuktiScreenshotUrl: body.yuktiScreenshotUrl ?? "",
      presentedInCompetition: body.presentedInCompetition ?? null,
      competitionName: body.competitionName ?? "",
      organizedBy: body.organizedBy ?? "",
      remarks: body.remarks ?? "",
      addedBy: session.uid,
      addedByName,
      createdAt: now,
      updatedAt: now,
    });

    if (!isRnD) {
      await notifyRole(
        db, session.collegeId, "R_AND_D",
        "INNOVATION_PENDING_VERIFICATION",
        "New innovation record submitted for verification",
        `${owner.name ?? "A staff member"} submitted "${innovationTitle}" for verification`,
        "/r-and-d/innovations"
      );
    }

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/innovations POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
