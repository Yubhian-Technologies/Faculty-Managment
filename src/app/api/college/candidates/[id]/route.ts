export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER", "ACCOUNTS");
    const { id } = await params;
    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("candidates")
      .doc(id)
      .get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ candidate: { id: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[candidates/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const { id } = await params;
    const body = (await request.json()) as {
      resumeUrl?: string;
      name?: string;
      email?: string;
      phone?: string;
    };

    const db = getAdminDb();
    const now = new Date();

    const candidateSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("candidates")
      .doc(id)
      .get();

    if (!candidateSnap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updatedAt: now };
    const { resumeUrl, name, email, phone } = body;

    if (resumeUrl !== undefined) updates.resumeUrl = resumeUrl;
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;

    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("candidates")
      .doc(id)
      .update(updates);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[candidates/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // Block delete while the candidate has any live (non-REJECTED) applications,
    // matching the existing vacancy-requests/[id] DELETE guard pattern — avoids
    // orphaning CandidateApplication docs.
    const applicationsSnap = await collegeRef
      .collection("candidateApplications")
      .where("candidateId", "==", id)
      .get();
    const hasActiveApplication = applicationsSnap.docs.some(
      (d) => (d.data() as { status?: string }).status !== "REJECTED"
    );
    if (hasActiveApplication) {
      return NextResponse.json(
        { error: "Cannot delete a candidate with active hiring-request applications" },
        { status: 400 }
      );
    }

    await collegeRef.collection("candidates").doc(id).delete();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[candidates/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
