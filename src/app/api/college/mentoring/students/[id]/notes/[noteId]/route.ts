export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { authorizeMentoringStudent } from "@/lib/mentoring/access";
import { mentoringErrorResponse } from "@/lib/mentoring/http";

// A note can be removed only by the person who wrote it, and only while they
// still have access to the student (so a former mentor cannot reach back in).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const { id, noteId } = await params;
    const db = getAdminDb();
    const access = await authorizeMentoringStudent(db, session, id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const ref = db
      .collection("colleges").doc(session.collegeId)
      .collection("students").doc(id)
      .collection("mentoringNotes").doc(noteId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Note not found" }, { status: 404 });
    if ((snap.data() as { authorUid?: string }).authorUid !== session.uid) {
      return NextResponse.json({ error: "You can only delete your own notes" }, { status: 403 });
    }
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/students/[id]/notes/[noteId] DELETE]");
  }
}
