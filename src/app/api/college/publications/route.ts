export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember, verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notifyRole } from "@/lib/notify";
import { PUBLICATION_ELIGIBLE_ROLES } from "@/lib/publications/eligibleRoles";
import { resolveOwnerDesignation } from "@/lib/publications/resolveOwnerDesignation";
import type { PublicationStatus, UserRole } from "@/types";

// Every college-scoped staff role - any of them can read their own
// publications; only R_AND_D can read across the whole college or write.
const COLLEGE_STAFF_ROLES = PUBLICATION_ELIGIBLE_ROLES;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // SUPER_ADMIN has no session.collegeId (GLOBAL scope), so it can't go
    // through requireCollegeMember - resolve the college from an explicit
    // query param instead (e.g. the resume-download flow on the Users page,
    // which needs a specific person's R&D-managed publications).
    const globalSession = await verifySession();
    let collegeId: string;
    let role: string;
    let uid: string;
    if (globalSession?.role === "SUPER_ADMIN") {
      const collegeIdParam = searchParams.get("collegeId");
      if (!collegeIdParam) return NextResponse.json({ error: "collegeId required" }, { status: 400 });
      collegeId = collegeIdParam;
      role = globalSession.role;
      uid = globalSession.uid;
    } else {
      const session = await requireCollegeMember(...COLLEGE_STAFF_ROLES);
      collegeId = session.collegeId;
      role = session.role;
      uid = session.uid;
    }

    const db = getAdminDb();
    const coll = db.collection("colleges").doc(collegeId).collection("publications");

    // R&D manages every record (optionally drilling into one uid); Principal/VP/HOD
    // may look up a specific uid too, since they already have full read access to
    // any faculty member's profile elsewhere (module-tile View pages). SUPER_ADMIN
    // gets the same drill-down access. Every other role can only ever see their
    // own rows, regardless of query params.
    let query: FirebaseFirestore.Query = coll;
    const canQueryAnyUid = ["R_AND_D", "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN"].includes(role);
    if (canQueryAnyUid) {
      const uidFilter = searchParams.get("uid");
      if (uidFilter) query = query.where("uid", "==", uidFilter);
      else if (role !== "R_AND_D" && role !== "SUPER_ADMIN") query = query.where("uid", "==", uid);
    } else {
      query = query.where("uid", "==", uid);
    }

    const snap = await query.get();
    const publications = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      // A record with no `status` predates self-submission and was R&D-added
      // - treat that as approved. Only R&D (manages the review queue) and the
      // record's own owner (sees their own pending/rejected submissions) ever
      // see anything else; every other viewer - including Principal/HOD
      // drilling into someone else's uid - only sees approved/legacy rows.
      .filter((p) => {
        const pub = p as { status?: PublicationStatus; uid?: string };
        if (!pub.status || pub.status === "APPROVED") return true;
        return role === "R_AND_D" || role === "SUPER_ADMIN" || pub.uid === uid;
      })
      .sort((a, b) => ((b as { publicationYear?: number }).publicationYear ?? 0) - ((a as { publicationYear?: number }).publicationYear ?? 0));

    return NextResponse.json({ publications });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/publications GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...PUBLICATION_ELIGIBLE_ROLES);
    const isRnD = session.role === "R_AND_D";

    const body = (await request.json()) as {
      uid?: string;
      title?: string;
      coAuthors?: string;
      journalOrConference?: string;
      publicationYear?: number;
      indexing?: string;
      driveLink?: string;
    };
    // Self-submission can only ever credit the submitter's own login -
    // any `uid` in the body is ignored for everyone except R&D, who is
    // recording it on someone else's behalf.
    const uid = isRnD ? body.uid : session.uid;
    const { title, coAuthors, journalOrConference, publicationYear, indexing, driveLink } = body;

    if (!uid || !title || !journalOrConference || !publicationYear) {
      return NextResponse.json({ error: "uid, title, journalOrConference and publicationYear are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const ownerSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(uid).get();
    if (!ownerSnap.exists) {
      return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    }
    const owner = ownerSnap.data() as { name?: string; role?: UserRole };
    if (!owner.role || !PUBLICATION_ELIGIBLE_ROLES.includes(owner.role)) {
      return NextResponse.json({ error: "Publications can only be recorded for staff, not students" }, { status: 400 });
    }

    let addedByName = "R&D";
    try {
      const addedBySnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      addedByName = (addedBySnap.data() as { name?: string } | undefined)?.name ?? (isRnD ? "R&D" : "Unknown");
    } catch { /* best-effort */ }

    const ownerDesignation = await resolveOwnerDesignation(db, session.collegeId, uid, owner.role);

    const now = new Date();
    const docRef = await db.collection("colleges").doc(session.collegeId).collection("publications").add({
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
      coAuthors: coAuthors ?? "",
      journalOrConference,
      publicationYear,
      ...(indexing ? { indexing } : {}),
      ...(driveLink ? { driveLink } : {}),
      addedBy: session.uid,
      addedByName,
      createdAt: now,
      updatedAt: now,
    });

    if (!isRnD) {
      await notifyRole(
        db, session.collegeId, "R_AND_D",
        "PUBLICATION_PENDING_VERIFICATION",
        "New publication submitted for verification",
        `${owner.name ?? "A staff member"} submitted "${title}" for verification`,
        "/r-and-d/publications"
      );
    }

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/publications POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
