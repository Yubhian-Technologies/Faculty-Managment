export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { readOnlyRecordPart } from "@/lib/mentoring/readOnlyRecord";
import { toMenteeSummary } from "@/lib/mentoring/summary";
import type { StudentRecord } from "@/types";

// One student's Mentoring Record for the Principal / Vice-Principal of the student's own college
// (the student is read from the caller's college path, so another college's id is simply a 404).
// Read-only: ?part=summary (default), record, semesters, sheet (&semester=<n>), entries - the same
// parts and the same omissions as the student's own view (referrals, health record, semester
// remarks, mentoring notes stay with the mentor and HOD). Nothing here writes.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL");
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const part = searchParams.get("part") ?? "summary";

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("students").doc(id).get();
    if (!snap.exists) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    const student = { ...(snap.data() as StudentRecord), id: snap.id };

    if (part === "summary") return NextResponse.json({ student: toMenteeSummary(student) });
    const answer = await readOnlyRecordPart(db, session.collegeId, student, part, searchParams);
    return answer ?? NextResponse.json({ error: "part must be summary, record, semesters, sheet or entries" }, { status: 400 });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/college-students/[id] GET]");
  }
}
