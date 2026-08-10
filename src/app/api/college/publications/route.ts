export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember, verifySession } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { UserRole } from "@/types";

// Every college-scoped staff role - any of them can read their own
// publications; only R_AND_D can read across the whole college or write.
const COLLEGE_STAFF_ROLES = [
  "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "COLLEGE_OFFICE", "COLLEGE_STAFF",
  "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "PLACEMENT_DEPT",
  "LIBRARY", "EXAM_CELL", "WEBMASTER", "PANEL_MEMBER",
];

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
    const session = await requireCollegeMember("R_AND_D");

    const body = (await request.json()) as {
      uid?: string;
      title?: string;
      coAuthors?: string;
      journalOrConference?: string;
      publicationYear?: number;
      indexing?: string;
      driveLink?: string;
    };
    const { uid, title, coAuthors, journalOrConference, publicationYear, indexing, driveLink } = body;

    if (!uid || !title || !journalOrConference || !publicationYear) {
      return NextResponse.json({ error: "uid, title, journalOrConference and publicationYear are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const ownerSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(uid).get();
    if (!ownerSnap.exists) {
      return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
    }
    const owner = ownerSnap.data() as { name?: string; role?: UserRole };

    let addedByName = "R&D";
    try {
      const addedBySnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      addedByName = (addedBySnap.data() as { name?: string } | undefined)?.name ?? "R&D";
    } catch { /* best-effort */ }

    const now = new Date();
    const docRef = await db.collection("colleges").doc(session.collegeId).collection("publications").add({
      collegeId: session.collegeId,
      uid,
      ownerName: owner.name ?? "Unknown",
      ownerRole: owner.role,
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

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/publications POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
