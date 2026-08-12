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
      citation: string;
      journalOrConference: string;
      publicationYear: number;
      indexing: string;
      driveLink: string;
      // Extra report fields - see ResearchPublication (src/types/core.ts).
      department: string;
      authorPosition: string;
      venueType: string;
      facultyOrStudent: string;
      impactFactor: string;
      sjr: string;
      quartile: string;
      isbnIssn: string;
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
    if (body.citation !== undefined) updates.citation = body.citation;
    if (body.journalOrConference !== undefined) updates.journalOrConference = body.journalOrConference;
    if (body.publicationYear !== undefined) updates.publicationYear = body.publicationYear;
    if (body.indexing !== undefined) updates.indexing = body.indexing;
    if (body.department !== undefined) updates.department = body.department;
    if (body.authorPosition !== undefined) updates.authorPosition = body.authorPosition;
    if (body.venueType !== undefined) updates.venueType = body.venueType;
    if (body.facultyOrStudent !== undefined) updates.facultyOrStudent = body.facultyOrStudent;
    if (body.impactFactor !== undefined) updates.impactFactor = body.impactFactor;
    if (body.sjr !== undefined) updates.sjr = body.sjr;
    if (body.quartile !== undefined) updates.quartile = body.quartile;
    if (body.isbnIssn !== undefined) updates.isbnIssn = body.isbnIssn;
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
