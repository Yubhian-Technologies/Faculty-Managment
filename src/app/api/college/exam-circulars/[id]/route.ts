export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminStorage } from "@/lib/firebase/admin";

// Same floor as the create route's isPastDate - see its comment on why UTC
// here is safe against an IST caller's local "today".
function isPastDate(dateStr: string): boolean {
  return dateStr < new Date().toISOString().slice(0, 10);
}

// A FILE circular has nothing to fix up but its title (see exam-guidelines'
// PATCH for why extraction gets a richer edit) - re-upload to replace the
// file itself. A NOTICE circular has no file at all, so every field it was
// created with can be edited here.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      title?: string;
      courseId?: string; courseName?: string; semester?: number; totalSemesters?: number;
      noticeDate?: string; subject?: string; body?: string;
    };

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("examCirculars").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const existing = snap.data() as { kind?: string };

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (existing.kind === "NOTICE") {
      const { courseId, courseName, semester, totalSemesters, noticeDate, subject } = body;
      const noticeBody = body.body;
      if (!courseName) return NextResponse.json({ error: "Course is required" }, { status: 400 });
      if (!semester || !totalSemesters) return NextResponse.json({ error: "Semester is required" }, { status: 400 });
      if (!noticeDate) return NextResponse.json({ error: "Date is required" }, { status: 400 });
      if (isPastDate(noticeDate)) return NextResponse.json({ error: "Date cannot be in the past" }, { status: 400 });
      if (!subject?.trim()) return NextResponse.json({ error: "Subject is required" }, { status: 400 });
      if (!noticeBody?.trim()) return NextResponse.json({ error: "Body is required" }, { status: 400 });
      Object.assign(updates, {
        courseId: courseId ?? null, courseName, semester, totalSemesters, noticeDate,
        subject: subject.trim(), title: subject.trim(), body: noticeBody.trim(),
      });
    } else {
      if (!body.title?.trim()) return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
      updates.title = body.title.trim();
    }

    await ref.update(updates);
    return NextResponse.json({ circular: { id, ...existing, ...updates } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-circulars/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const { id } = await params;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("examCirculars").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { fileUrl } = snap.data() as { fileUrl?: string };
    await ref.delete();

    const path = fileUrl ? decodeURIComponent(fileUrl.split("/o/")[1]?.split("?")[0] ?? "") : "";
    if (path) {
      try {
        await getAdminStorage().bucket().file(path).delete();
      } catch (err) {
        console.error("[college/exam-circulars/[id] DELETE] storage cleanup failed", err);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-circulars/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
