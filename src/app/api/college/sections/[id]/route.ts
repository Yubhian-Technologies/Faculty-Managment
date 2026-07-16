export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const { id } = await params;
    const body = (await request.json()) as {
      courseId?: string;
      name?: string;
      year?: number;
      batch?: string;
      studentCount?: number;
      facultyInchargeUid?: string | null;
      facultyInchargeName?: string;
    };

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("sections").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    const courseId = body.courseId ?? (snap.data() as { courseId?: string }).courseId;
    const targetYear = body.year != null ? Number(body.year) : (snap.data() as { year?: number }).year;

    if (courseId && (body.courseId != null || body.year != null)) {
      const courseSnap = await db.collection("colleges").doc(session.collegeId).collection("courses").doc(courseId).get();
      if (!courseSnap.exists) return NextResponse.json({ error: "Course not found" }, { status: 404 });
      const course = courseSnap.data() as { name: string; durationYears: number };
      if (targetYear != null && (targetYear < 1 || targetYear > course.durationYears)) {
        return NextResponse.json({ error: `Year must be between 1 and ${course.durationYears} for ${course.name}` }, { status: 400 });
      }
      if (body.courseId != null) {
        updates.courseId = courseId;
        updates.courseName = course.name;
      }
    }

    if (body.name != null) updates.name = body.name.trim().toUpperCase();
    if (body.year != null) updates.year = Number(body.year);
    if (body.batch != null) updates.batch = body.batch.trim();
    if (body.studentCount != null) updates.studentCount = Math.max(0, Number(body.studentCount));
    if ("facultyInchargeUid" in body) updates.facultyInchargeUid = body.facultyInchargeUid ?? null;
    if (body.facultyInchargeName != null) updates.facultyInchargeName = body.facultyInchargeName;

    await ref.update(updates);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[sections/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const { id } = await params;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("sections").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const data = snap.data() as { studentCount?: number };
    if ((data.studentCount ?? 0) > 0) {
      return NextResponse.json(
        { error: "Cannot delete a section that has students. Remove all students first." },
        { status: 409 }
      );
    }

    await ref.delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[sections/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
