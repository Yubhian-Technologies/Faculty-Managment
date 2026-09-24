export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminStorage } from "@/lib/firebase/admin";

// Lets Exam Cell fix up the auto-extracted points (or the title) by hand -
// extraction is a best-effort line-split (see extractPoints.ts), not a
// guaranteed clean list, so this is the expected way to clean up its output.
// The source file itself is never re-parsed here; re-uploading is the only
// way to change it.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as { title?: string; points?: string[] };

    const updates: Record<string, unknown> = {};
    if (typeof body.title === "string") {
      if (!body.title.trim()) return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
      updates.title = body.title.trim();
    }
    if (Array.isArray(body.points)) {
      const points = body.points.map((p) => p.trim()).filter((p) => p.length > 0);
      if (points.length === 0) return NextResponse.json({ error: "At least one point is required" }, { status: 400 });
      updates.points = points;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    updates.updatedAt = new Date();

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("examGuidelines").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await ref.update(updates);
    return NextResponse.json({ guideline: { id, ...snap.data(), ...updates } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-guidelines/[id] PATCH]", err);
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
    const ref = db.collection("colleges").doc(session.collegeId).collection("examGuidelines").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { fileUrl } = snap.data() as { fileUrl?: string };
    await ref.delete();

    // Best-effort cleanup - a missing/already-gone storage object shouldn't
    // block the Firestore record (the thing the UI actually reflects) from
    // being removed.
    const path = fileUrl ? decodeURIComponent(fileUrl.split("/o/")[1]?.split("?")[0] ?? "") : "";
    if (path) {
      try {
        await getAdminStorage().bucket().file(path).delete();
      } catch (err) {
        console.error("[college/exam-guidelines/[id] DELETE] storage cleanup failed", err);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-guidelines/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
