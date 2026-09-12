export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notifyRole } from "@/lib/notify";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import { resolveOwnerDesignation } from "@/lib/publications/resolveOwnerDesignation";
import type {
  HackathonEvaluatorItem, HackathonEventType, HackathonFacultyCoordinatorItem, HackathonLevel,
  PublicationStatus, UserRole, YuktiReferenceItem,
} from "@/types";

const COLLEGE_STAFF_ROLES = PUBLICATION_ELIGIBLE_ROLES;

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const { searchParams } = new URL(request.url);

    const db = getAdminDb();
    const coll = db.collection("colleges").doc(session.collegeId).collection("hackathons");

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
    console.error("[college/hackathons GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

interface HackathonBody {
  uid?: string;
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
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
    const isRnD = session.role === "R_AND_D";

    const body = (await request.json()) as HackathonBody;
    const uid = isRnD ? body.uid : session.uid;
    const { academicYear, eventTitle, eventType, levelOfEvent } = body;

    if (!uid || !academicYear || !eventTitle || !eventType || !levelOfEvent) {
      return NextResponse.json(
        { error: "uid, academicYear, eventTitle, eventType and levelOfEvent are required" },
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
      return NextResponse.json({ error: "Hackathon records can only be recorded for staff, not students" }, { status: 400 });
    }

    let addedByName = "R&D";
    try {
      const addedBySnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      addedByName = (addedBySnap.data() as { name?: string } | undefined)?.name ?? (isRnD ? "R&D" : "Unknown");
    } catch { /* best-effort */ }

    const ownerDesignation = await resolveOwnerDesignation(db, session.collegeId, uid, owner.role);

    const now = new Date();
    const docRef = await db.collection("colleges").doc(session.collegeId).collection("hackathons").add({
      collegeId: session.collegeId,
      uid,
      ownerName: owner.name ?? "Unknown",
      ownerRole: owner.role,
      ...(ownerDesignation ? { ownerDesignation } : {}),
      status: (isRnD ? "APPROVED" : "PENDING") satisfies PublicationStatus,
      academicYear,
      eventTitle,
      eventType,
      organizingDeptCell: body.organizingDeptCell ?? "",
      startDate: body.startDate ?? "",
      endDate: body.endDate ?? "",
      durationHours: body.durationHours ?? null,
      venue: body.venue ?? "",
      levelOfEvent,
      themeDomain: body.themeDomain ?? "",
      noOfProblemStatements: body.noOfProblemStatements ?? null,
      teamsRegisteredInternal: body.teamsRegisteredInternal ?? null,
      teamsRegisteredExternal: body.teamsRegisteredExternal ?? null,
      participantsInternal: body.participantsInternal ?? null,
      participantsExternal: body.participantsExternal ?? null,
      ideasPresentedCount: body.ideasPresentedCount ?? null,
      pocsPresentedCount: body.pocsPresentedCount ?? null,
      productsPresentedCount: body.productsPresentedCount ?? null,
      evaluators: body.evaluators ?? [],
      facultyCoordinators: body.facultyCoordinators ?? [],
      ideasUploadedYukti: body.ideasUploadedYukti ?? null,
      ideasVerifiedRecommendedYukti: body.ideasVerifiedRecommendedYukti ?? null,
      prototypesUploadedYukti: body.prototypesUploadedYukti ?? null,
      prototypesVerifiedRecommendedYukti: body.prototypesVerifiedRecommendedYukti ?? null,
      yuktiReferences: body.yuktiReferences ?? [],
      sanctionedLetterUrl: body.sanctionedLetterUrl ?? "",
      brochureUrl: body.brochureUrl ?? "",
      expenditureProofUrl: body.expenditureProofUrl ?? "",
      eventReportUrl: body.eventReportUrl ?? "",
      remarks: body.remarks ?? "",
      addedBy: session.uid,
      addedByName,
      createdAt: now,
      updatedAt: now,
    });

    if (!isRnD) {
      await notifyRole(
        db, session.collegeId, "R_AND_D",
        "HACKATHON_PENDING_VERIFICATION",
        "New hackathon/competition record submitted for verification",
        `${owner.name ?? "A staff member"} submitted "${eventTitle}" for verification`,
        "/r-and-d/hackathons"
      );
    }

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/hackathons POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
