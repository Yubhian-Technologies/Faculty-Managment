export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { SubjectType } from "@/types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      name?: string;
      code?: string;
      hoursPerWeek?: number;
      totalHoursPerSemester?: number | null;
      credits?: number;
      type?: SubjectType;
      isActive?: boolean;
    };

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("subjects").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name != null) updates.name = body.name.trim();
    if (body.code != null) updates.code = body.code.toUpperCase().trim();
    if (body.hoursPerWeek != null) updates.hoursPerWeek = Number(body.hoursPerWeek);
    if ("totalHoursPerSemester" in body) updates.totalHoursPerSemester = body.totalHoursPerSemester ?? null;
    if (body.credits != null) updates.credits = Number(body.credits);
    if (body.type != null) updates.type = body.type;
    if (body.isActive != null) updates.isActive = body.isActive;

    await ref.update(updates);

    // hoursPerWeek is shown/edited from multiple places (the Subjects page and every
    // faculty member's teaching-assignment editor) but is owned here — cascade it to every
    // existing teaching assignment for this subject so all of them (and the period-count
    // cap in their editors) stay in sync.
    if (body.hoursPerWeek != null) {
      const newHours = Number(body.hoursPerWeek);
      const assignmentsSnap = await db
        .collection("colleges").doc(session.collegeId)
        .collection("teachingAssignments")
        .where("subjectId", "==", id)
        .get();
      const now = new Date();
      for (let i = 0; i < assignmentsSnap.docs.length; i += 400) {
        const chunk = assignmentsSnap.docs.slice(i, i + 400);
        const batch = db.batch();
        for (const doc of chunk) batch.update(doc.ref, { hoursPerWeek: newHours, updatedAt: now });
        await batch.commit();
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[subjects/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("subjects").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[subjects/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
