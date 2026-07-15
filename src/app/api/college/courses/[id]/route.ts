export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      name?: string;
      code?: string;
      durationYears?: number;
      isActive?: boolean;
    };

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("courses").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name != null) updates.name = body.name.trim();
    if (body.code != null) updates.code = body.code.toUpperCase().trim();
    if (body.durationYears != null) {
      if (body.durationYears < 1 || body.durationYears > 10) {
        return NextResponse.json({ error: "durationYears must be between 1 and 10" }, { status: 400 });
      }
      updates.durationYears = Number(body.durationYears);
    }
    if (body.isActive != null) updates.isActive = body.isActive;

    await ref.update(updates);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[courses/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("courses").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const sectionsUsingCourse = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("sections")
      .where("courseId", "==", id)
      .limit(1)
      .get();
    if (!sectionsUsingCourse.empty) {
      return NextResponse.json(
        { error: "Cannot delete a course that has sections. Remove its sections first." },
        { status: 409 }
      );
    }

    const timingsSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("courseYearTimings")
      .where("courseId", "==", id)
      .get();
    const batch = db.batch();
    timingsSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(ref);
    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[courses/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
