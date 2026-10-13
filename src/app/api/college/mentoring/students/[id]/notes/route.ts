export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorOf } from "@/lib/audit/actorOf";
import { authorizeMentoringStudent } from "@/lib/mentoring/access";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { MENTORING_NOTE_MAX_LENGTH } from "@/types/mentoring";

// A mentee's mentoring notes (dated, newest first). Visible to and written by
// the student's mentor and the HOD who manages the student - the student never
// sees them.
const notesCol = (db: FirebaseFirestore.Firestore, collegeId: string, studentId: string) =>
  db.collection("colleges").doc(collegeId).collection("students").doc(studentId).collection("mentoringNotes");

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const { id } = await params;
    const db = getAdminDb();
    const access = await authorizeMentoringStudent(db, session, id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const snap = await notesCol(db, session.collegeId, id).orderBy("createdAt", "desc").limit(200).get();
    const notes = snap.docs.map((d) => {
      const n = d.data() as { text?: string; authorUid?: string; authorName?: string; createdAt?: { toDate?: () => Date } };
      return {
        id: d.id,
        text: n.text ?? "",
        authorUid: n.authorUid ?? "",
        authorName: n.authorName ?? "",
        createdAt: n.createdAt?.toDate?.().toISOString() ?? null,
        mine: n.authorUid === session.uid,
      };
    });
    return NextResponse.json({ notes });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/students/[id]/notes GET]");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const { id } = await params;
    const body = (await readJsonBody(request)) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return NextResponse.json({ error: "Write a note first" }, { status: 400 });
    if (text.length > MENTORING_NOTE_MAX_LENGTH) {
      return NextResponse.json({ error: `A note can be at most ${MENTORING_NOTE_MAX_LENGTH} characters` }, { status: 400 });
    }

    const db = getAdminDb();
    const access = await authorizeMentoringStudent(db, session, id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const actor = await actorOf(db, session.collegeId, session.uid, session.email);
    const now = new Date();
    const ref = await notesCol(db, session.collegeId, id).add({
      text, authorUid: session.uid, authorName: actor.name, createdAt: now,
    });
    return NextResponse.json({
      note: { id: ref.id, text, authorUid: session.uid, authorName: actor.name, createdAt: now.toISOString(), mine: true },
    }, { status: 201 });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/students/[id]/notes POST]");
  }
}
