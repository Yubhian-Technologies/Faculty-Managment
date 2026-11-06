export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canHodEditDepartment, getHodDepartmentScope } from "@/lib/departments/scope";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { istDateKey } from "@/lib/attendance/istTime";
import { guardError, midBankRefs } from "@/lib/midBank/server";
import type { MidPaperFinal } from "@/types";

// The finalized (printed) question paper of one exam (?choiceId), for entering marks against it:
//  - faculty with a marks batch of that subject in that branch, and the branch's HOD - from the exam date on;
//  - Principal / VP / Exam Cell any time.
// Never with the answer key (MCQ / fill-in answers are left out) except for the Exam Cell.

const OVERSEERS = ["EXAM_CELL", "SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"];

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", ...OVERSEERS);
    const choiceId = new URL(request.url).searchParams.get("choiceId") ?? "";
    if (!choiceId) return NextResponse.json({ error: "choiceId is required" }, { status: 400 });
    const db = getAdminDb();
    const college = midBankRefs(db, session.collegeId).college;
    const snap = await college.collection("midPaperChoices").doc(choiceId).get();
    const c = snap.data() as { subjectId: string; branch: string; date: string; final?: MidPaperFinal } | undefined;
    if (!c?.final) return NextResponse.json({ error: "This question paper isn't finalized yet" }, { status: 404 });

    if (!OVERSEERS.includes(session.role)) {
      if (c.date > istDateKey()) return NextResponse.json({ error: `The question paper can be viewed from the exam date (${c.date})` }, { status: 403 });
      let allowed = false;
      if (session.role === "HOD") allowed = canHodEditDepartment(await getHodDepartmentScope(db, session.collegeId, session.uid), c.branch);
      if (!allowed) {
        const facultyId = await resolveFacultyMemberId(db, session.collegeId, session.uid);
        const mine = await college.collection("internalExamMarks").where("subjectId", "==", c.subjectId).where("facultyId", "==", facultyId).get();
        allowed = mine.docs.some((d) => d.get("department") === c.branch);
      }
      if (!allowed) return NextResponse.json({ error: "Only faculty entering marks for this subject in this branch can view it" }, { status: 403 });
    }
    const withKey = session.role === "EXAM_CELL" || session.role === "SUPER_ADMIN";
    const final: MidPaperFinal = withKey ? c.final : {
      ...c.final,
      questions: c.final.questions.map((q) => { const { answer: _a, ...rest } = q; void _a; return rest; }),
    };
    return NextResponse.json({ final });
  } catch (err) {
    return guardError(err, "[college/mid-paper-choices/final GET]");
  }
}
