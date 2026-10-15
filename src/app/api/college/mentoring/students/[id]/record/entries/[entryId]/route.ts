export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorOf } from "@/lib/audit/actorOf";
import { authorizeMentoringStudent } from "@/lib/mentoring/access";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { cleanEntryValues, entrySection } from "@/lib/mentoring/recordSections";
import { entriesCol, toEntry } from "@/lib/mentoring/recordStore";

// Edit or remove one row of the Student Mentoring Record. Unlike a private note, the record
// belongs to the student, not to whoever typed a row: the mentor (and the HOD) may correct or
// remove any row, so it stays right when a student gets a new mentor.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const { id, entryId } = await params;
    const body = (await readJsonBody(request)) as { values?: unknown };

    const db = getAdminDb();
    const access = await authorizeMentoringStudent(db, session, id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const ref = entriesCol(db, session.collegeId, id).doc(entryId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Row not found" }, { status: 404 });
    const section = entrySection((snap.data() as { section?: string }).section ?? "");
    if (!section) return NextResponse.json({ error: "Unknown section" }, { status: 400 });

    const clean = cleanEntryValues(section, body.values);
    if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 400 });

    const actor = await actorOf(db, session.collegeId, session.uid, session.email);
    await ref.update({ values: clean.values, updatedAt: new Date(), updatedByUid: session.uid, updatedByName: actor.name });
    return NextResponse.json({ entry: toEntry(await ref.get()) });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/students/[id]/record/entries/[entryId] PATCH]");
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const { id, entryId } = await params;
    const db = getAdminDb();
    const access = await authorizeMentoringStudent(db, session, id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const ref = entriesCol(db, session.collegeId, id).doc(entryId);
    if (!(await ref.get()).exists) return NextResponse.json({ error: "Row not found" }, { status: 404 });
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/students/[id]/record/entries/[entryId] DELETE]");
  }
}
