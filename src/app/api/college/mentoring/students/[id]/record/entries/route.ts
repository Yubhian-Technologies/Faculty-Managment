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

// Adds a row to one of the Student Mentoring Record's tables / lists (scholarship, internship,
// meeting, ...). The student's mentor and the HOD who manages them write it; the student never
// sees the record.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const { id } = await params;
    const body = (await readJsonBody(request)) as { section?: unknown; semester?: unknown; values?: unknown };
    const section = typeof body.section === "string" ? entrySection(body.section) : undefined;
    if (!section) return NextResponse.json({ error: "Unknown section" }, { status: 400 });

    let semester: number | null = null;
    if (section.perSemester) {
      semester = typeof body.semester === "number" ? body.semester : Number.NaN;
      if (!Number.isInteger(semester) || semester < 1 || semester > 12) return NextResponse.json({ error: "Pick the semester" }, { status: 400 });
    }
    const clean = cleanEntryValues(section, body.values);
    if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 400 });

    const db = getAdminDb();
    const access = await authorizeMentoringStudent(db, session, id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const col = entriesCol(db, session.collegeId, id);
    const existing = await col.where("section", "==", section.key).count().get();
    if (existing.data().count >= section.maxEntries) {
      return NextResponse.json({ error: `A record can hold at most ${section.maxEntries} rows here` }, { status: 400 });
    }

    const actor = await actorOf(db, session.collegeId, session.uid, session.email);
    const now = new Date();
    const ref = await col.add({
      section: section.key, semester, values: clean.values,
      createdByUid: session.uid, createdByName: actor.name, createdAt: now, updatedAt: now,
    });
    return NextResponse.json({ entry: toEntry(await ref.get()) }, { status: 201 });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/students/[id]/record/entries POST]");
  }
}
