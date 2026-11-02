export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { findOwnStudent } from "@/lib/students/ownContext";
import { passwordChangeRequired, passwordChangeRequiredResponse } from "@/lib/students/passwordGate";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { STUDENT_ENTRY_SECTIONS, cleanEntryValues, entrySection, studentSectionView } from "@/lib/mentoring/recordSections";
import { entriesCol, toEntry } from "@/lib/mentoring/recordStore";

// A student adds a row to their OWN Mentoring Record - scholarships, internships, placements, competitive exams,
// higher studies, achievements (STUDENT_ENTRY_SECTIONS). Always the signed-in student's record (session.uid), never
// an id from the client. "Supporting document received" stays the mentor's to tick.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const own = await findOwnStudent(db, session.collegeId, session.uid);
    if (!own.ok) return NextResponse.json({ error: "Your login is not linked to a student record yet. Please contact your College Office." }, { status: 404 });
    if (passwordChangeRequired(own.student)) return passwordChangeRequiredResponse();

    const body = (await readJsonBody(request)) as { section?: unknown; values?: unknown };
    const section = typeof body.section === "string" ? entrySection(body.section) : undefined;
    if (!section || !STUDENT_ENTRY_SECTIONS.has(section.key)) return NextResponse.json({ error: "Only your mentor can add to this part of the record" }, { status: 403 });
    const clean = cleanEntryValues(studentSectionView(section), body.values);
    if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 400 });

    const col = entriesCol(db, session.collegeId, own.student.id);
    const existing = await col.where("section", "==", section.key).count().get();
    if (existing.data().count >= section.maxEntries) return NextResponse.json({ error: `A record can hold at most ${section.maxEntries} rows here` }, { status: 400 });

    const now = new Date();
    const ref = await col.add({
      section: section.key, semester: null, values: clean.values, addedByStudent: true,
      createdByUid: session.uid, createdByName: own.student.name ?? "Student", createdAt: now, updatedAt: now,
    });
    return NextResponse.json({ entry: toEntry(await ref.get()) }, { status: 201 });
  } catch (err) {
    return mentoringErrorResponse(err, "[student/me/mentoring/record/entries POST]");
  }
}
