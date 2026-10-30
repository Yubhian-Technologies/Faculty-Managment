export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorName, guardError } from "@/lib/midBank/server";
import { checkMarksBreakdown } from "@/lib/exams/marksBreakdown";
import { MARKS_CATEGORY_ROLES } from "@/lib/exams/marksCategoriesServer";
import type { ExamMarksCategory } from "@/types";

// Exam Cell > Mid Configuration > Marks > Marks categories: named internal marks
// breakdowns for groups of subjects. GET lists them; POST creates one (no
// subjects yet - they are added on the category).

export async function GET() {
  try {
    const session = await requireCollegeMember(...MARKS_CATEGORY_ROLES);
    const snap = await getAdminDb().collection("colleges").doc(session.collegeId).collection("examMarksCategories").get();
    const categories = snap.docs.map((d) => ({ ...(d.data() as ExamMarksCategory), id: d.id })).sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ categories });
  } catch (err) {
    return guardError(err, "[college/exam-marks-categories GET]");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...MARKS_CATEGORY_ROLES);
    const body = (await readJsonBody(request)) as { name?: string; examType?: string; internalMaxMarks?: unknown; externalMaxMarks?: unknown; components?: unknown };
    const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) return NextResponse.json({ error: "Give the category a name" }, { status: 400 });
    const examType = body.examType === "LAB" ? "LAB" : "THEORY";
    const checked = checkMarksBreakdown(body);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    const db = getAdminDb();
    const data = {
      name, examType, internalMaxMarks: checked.internalMaxMarks, externalMaxMarks: checked.externalMaxMarks, components: checked.components,
      subjectIds: [], subjects: [], updatedBy: session.uid, updatedByName: await actorName(db, session.collegeId, session.uid), updatedAt: new Date(),
    };
    const ref = await db.collection("colleges").doc(session.collegeId).collection("examMarksCategories").add(data);
    return NextResponse.json({ category: { id: ref.id, ...data } }, { status: 201 });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/exam-marks-categories POST]");
  }
}
