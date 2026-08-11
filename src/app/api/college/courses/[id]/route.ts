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
      catalogId?: string;
      isActive?: boolean;
    };

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const ref = collegeRef.collection("courses").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    // Re-pointing a course to a different catalog entry re-derives its
    // name/code/duration from the catalog - never from free-typed input.
    if (body.catalogId != null) {
      const catalogSnap = await collegeRef.collection("courseCatalog").doc(body.catalogId).get();
      if (!catalogSnap.exists) {
        return NextResponse.json({ error: "Selected course is not in the catalog" }, { status: 400 });
      }
      const catalog = catalogSnap.data() as { name: string; code: string; durationYears: number };
      const departmentId = (snap.data() as { departmentId?: string }).departmentId;

      const dupe = await collegeRef.collection("courses")
        .where("departmentId", "==", departmentId)
        .where("catalogId", "==", body.catalogId)
        .limit(2)
        .get();
      if (dupe.docs.some((d) => d.id !== id)) {
        return NextResponse.json({ error: "This course is already added to the department" }, { status: 409 });
      }

      updates.catalogId = body.catalogId;
      updates.name = catalog.name;
      updates.code = catalog.code;
      updates.durationYears = Number(catalog.durationYears);
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
