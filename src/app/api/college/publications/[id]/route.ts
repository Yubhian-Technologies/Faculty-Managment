export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("R_AND_D");
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("publications").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Publication not found" }, { status: 404 });
    }

    return NextResponse.json({ publication: { id: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/publications/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("R_AND_D");
    const { id } = await params;

    const body = (await request.json()) as Partial<{
      title: string;
      coAuthors: string;
      journalOrConference: string;
      publicationYear: number;
      indexing: string;
      driveLink: string;
      // Extra bibliometric/report fields - see ResearchPublication (src/types/core.ts).
      department: string;
      authorPosition: string;
      authorsId: string;
      venueType: string;
      documentType: string;
      facultyOrStudent: string;
      impactFactor: string;
      sjr: string;
      quartile: string;
      isbnIssn: string;
      volume: string;
      issue: string;
      articleNo: string;
      pageStart: string;
      pageEnd: string;
      citedBy: number;
      publicationStage: string;
      openAccess: string;
      eid: string;
    }>;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("publications").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Publication not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) updates.title = body.title;
    if (body.coAuthors !== undefined) updates.coAuthors = body.coAuthors;
    if (body.journalOrConference !== undefined) updates.journalOrConference = body.journalOrConference;
    if (body.publicationYear !== undefined) updates.publicationYear = body.publicationYear;
    if (body.indexing !== undefined) updates.indexing = body.indexing;
    if (body.department !== undefined) updates.department = body.department;
    if (body.authorPosition !== undefined) updates.authorPosition = body.authorPosition;
    if (body.authorsId !== undefined) updates.authorsId = body.authorsId;
    if (body.venueType !== undefined) updates.venueType = body.venueType;
    if (body.documentType !== undefined) updates.documentType = body.documentType;
    if (body.facultyOrStudent !== undefined) updates.facultyOrStudent = body.facultyOrStudent;
    if (body.impactFactor !== undefined) updates.impactFactor = body.impactFactor;
    if (body.sjr !== undefined) updates.sjr = body.sjr;
    if (body.quartile !== undefined) updates.quartile = body.quartile;
    if (body.isbnIssn !== undefined) updates.isbnIssn = body.isbnIssn;
    if (body.volume !== undefined) updates.volume = body.volume;
    if (body.issue !== undefined) updates.issue = body.issue;
    if (body.articleNo !== undefined) updates.articleNo = body.articleNo;
    if (body.pageStart !== undefined) updates.pageStart = body.pageStart;
    if (body.pageEnd !== undefined) updates.pageEnd = body.pageEnd;
    if (body.citedBy !== undefined) updates.citedBy = body.citedBy;
    if (body.publicationStage !== undefined) updates.publicationStage = body.publicationStage;
    if (body.openAccess !== undefined) updates.openAccess = body.openAccess;
    if (body.eid !== undefined) updates.eid = body.eid;
    if (body.driveLink !== undefined) updates.driveLink = body.driveLink;

    await ref.update(updates);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/publications/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("R_AND_D");
    const { id } = await params;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("publications").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Publication not found" }, { status: 404 });
    }

    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/publications/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
