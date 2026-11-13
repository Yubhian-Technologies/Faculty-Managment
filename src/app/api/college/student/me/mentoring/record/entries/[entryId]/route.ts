export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { findOwnStudent } from "@/lib/students/ownContext";
import { passwordChangeRequired, passwordChangeRequiredResponse } from "@/lib/students/passwordGate";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { STUDENT_ENTRY_SECTIONS, cleanEntryValues, entrySection, studentSectionView } from "@/lib/mentoring/recordSections";
import { entriesCol, toEntry } from "@/lib/mentoring/recordStore";

// A student edits / removes a row of their own Mentoring Record - only one THEY added (addedByStudent, by this login),
// in a section students may fill. Rows the mentor added are the mentor's. The mentor's "document received" tick is kept.

async function ownRow(db: Firestore, collegeId: string, uid: string, entryId: string) {
  const own = await findOwnStudent(db, collegeId, uid);
  if (!own.ok) return { error: NextResponse.json({ error: "Your login is not linked to a student record yet. Contact your College Office." }, { status: 404 }) };
  if (passwordChangeRequired(own.student)) return { error: passwordChangeRequiredResponse() };
  const ref = entriesCol(db, collegeId, own.student.id).doc(entryId);
  const snap = await ref.get();
  if (!snap.exists) return { error: NextResponse.json({ error: "Row not found" }, { status: 404 }) };
  const d = snap.data() as { section?: string; addedByStudent?: boolean; createdByUid?: string; values?: Record<string, unknown> };
  if (!d.addedByStudent || d.createdByUid !== uid || !STUDENT_ENTRY_SECTIONS.has(d.section ?? "")) {
    return { error: NextResponse.json({ error: "Only the rows you added can be changed - ask your mentor about this one" }, { status: 403 }) };
  }
  return { ref, data: d };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  try {
    const session = await requireCollegeMember("STUDENT");
    const { entryId } = await params;
    const db = getAdminDb();
    const row = await ownRow(db, session.collegeId, session.uid, entryId);
    if ("error" in row) return row.error;
    const section = entrySection(row.data.section ?? "")!;
    const body = (await readJsonBody(request)) as { values?: unknown };
    const clean = cleanEntryValues(studentSectionView(section), body.values);
    if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 400 });
    const kept = row.data.values?.docReceived === true ? { docReceived: true } : {};
    await row.ref.update({ values: { ...clean.values, ...kept }, updatedAt: new Date(), updatedByUid: session.uid });
    return NextResponse.json({ entry: toEntry(await row.ref.get()) });
  } catch (err) {
    return mentoringErrorResponse(err, "[student/me/mentoring/record/entries/[entryId] PATCH]");
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  try {
    const session = await requireCollegeMember("STUDENT");
    const { entryId } = await params;
    const row = await ownRow(getAdminDb(), session.collegeId, session.uid, entryId);
    if ("error" in row) return row.error;
    await row.ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mentoringErrorResponse(err, "[student/me/mentoring/record/entries/[entryId] DELETE]");
  }
}
