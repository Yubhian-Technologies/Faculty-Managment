export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorOf } from "@/lib/audit/actorOf";
import { authorizeMentoringStudent } from "@/lib/mentoring/access";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { SEMESTER_REMARKS_MAX_LENGTH } from "@/lib/mentoring/recordSections";
import { semesterDocRef } from "@/lib/mentoring/semesterSnapshot";

// "Remarks of the mentor on attendance and performance" for one semester page. Kept on the
// semester's own document, beside the subject copy; saving never touches the subject copy.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const { id } = await params;
    const body = (await readJsonBody(request)) as { semester?: unknown; remarks?: unknown };
    const semester = typeof body.semester === "number" ? body.semester : Number.NaN;
    if (!Number.isInteger(semester) || semester < 1 || semester > 12) return NextResponse.json({ error: "Pick the semester" }, { status: 400 });
    const remarks = typeof body.remarks === "string" ? body.remarks.trim() : "";
    if (remarks.length > SEMESTER_REMARKS_MAX_LENGTH) {
      return NextResponse.json({ error: `Remarks can be at most ${SEMESTER_REMARKS_MAX_LENGTH} characters` }, { status: 400 });
    }

    const db = getAdminDb();
    const access = await authorizeMentoringStudent(db, session, id);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const actor = await actorOf(db, session.collegeId, session.uid, session.email);
    const now = new Date();
    await semesterDocRef(db, session.collegeId, id, semester).set(
      { semester, remarks, remarksByUid: session.uid, remarksByName: actor.name, remarksAt: now, updatedAt: now },
      { merge: true }
    );
    return NextResponse.json({ remarks: remarks ? { text: remarks, byName: actor.name, at: now.toISOString() } : null });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/students/[id]/record/semester PATCH]");
  }
}
