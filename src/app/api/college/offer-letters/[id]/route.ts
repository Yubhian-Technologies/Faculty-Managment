export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { provisionFacultyFromOffer } from "@/lib/firestore/facultyProvisioning";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      status?: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED";
    };

    const db = getAdminDb();
    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (body.status) updates.status = body.status;

    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("offerLetters")
      .doc(id)
      .update(updates);

    // Auto-create faculty account as soon as the offer letter is sent
    let provisioning: Awaited<ReturnType<typeof provisionFacultyFromOffer>> | undefined;
    if (body.status === "SENT") {
      provisioning = await provisionFacultyFromOffer(db, session.collegeId, id);
    }

    // When candidate formally accepts, mark them APPROVED
    if (body.status === "ACCEPTED") {
      const letterSnap = await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("offerLetters")
        .doc(id)
        .get();
      const candidateId = (letterSnap.data() as { candidateId?: string }).candidateId;
      if (candidateId) {
        await db
          .collection("colleges")
          .doc(session.collegeId)
          .collection("candidates")
          .doc(candidateId)
          .update({ status: "APPROVED", updatedAt: now });
      }
    }

    return NextResponse.json({ ok: true, provisioning });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[offer-letters/[id] PATCH]", err);
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

    await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("offerLetters")
      .doc(id)
      .delete();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[offer-letters/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
