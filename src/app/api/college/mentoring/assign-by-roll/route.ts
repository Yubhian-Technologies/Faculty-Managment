export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { getInChunks } from "@/lib/firestore/inQuery";
import { loadHodStudentScope } from "@/lib/mentoring/access";
import { announceMentorChange, resolveMentorForHod } from "@/lib/mentoring/assignMentor";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import {
  ROLL_ASSIGN_MAX, classifyRoll, parseRollNumbers, summarizeRollPlan, type RollPlanItem, type RollStudent,
} from "@/lib/mentoring/rollAssignment";
import { rollNumberUpperOf } from "@/lib/students/loginDefaults";
import type { StudentRecord } from "@/types";

// Give a mentor students by roll number - the way subjects are assigned by code: the HOD pastes roll
// numbers, `validate` says what each one comes to, `commit` assigns them. Like the subject flow it is
// all-or-nothing: one roll that can't be assigned (unknown, another department's, graduated, or already
// with another mentor) and nothing is saved. A student already with THIS mentor is left as it is.
// HOD only, and only students the HOD manages.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD");
    const body = (await readJsonBody(request)) as { mentorUid?: string; rollNumbers?: string; mode?: string };
    const mentorUid = typeof body.mentorUid === "string" ? body.mentorUid.trim() : "";
    const mode = body.mode === "commit" ? "commit" : "validate";
    if (!mentorUid) return NextResponse.json({ error: "Pick a mentor first" }, { status: 400 });
    const { rolls, repeated } = parseRollNumbers(body.rollNumbers ?? "");
    if (rolls.length === 0) return NextResponse.json({ error: "Enter at least one roll number" }, { status: 400 });
    if (rolls.length > ROLL_ASSIGN_MAX) {
      return NextResponse.json({ error: `Enter at most ${ROLL_ASSIGN_MAX} roll numbers at a time` }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const { scope, canManage } = await loadHodStudentScope(db, session.collegeId, session.uid);

    const mentor = await resolveMentorForHod(db, session.collegeId, session.uid, scope, mentorUid);
    if (!mentor.ok) return NextResponse.json({ error: mentor.error }, { status: mentor.status });

    // A roll is stored upper-cased in rollNumberUpper; a record that predates that field is found by the roll as typed.
    const [byUpper, byRoll] = await Promise.all([
      getInChunks(rolls, (chunk) => collegeRef.collection("students").where("rollNumberUpper", "in", chunk)),
      getInChunks(rolls, (chunk) => collegeRef.collection("students").where("rollNumber", "in", chunk)),
    ]);
    const studentByRoll = new Map<string, { ref: FirebaseFirestore.DocumentReference; data: StudentRecord & { id: string } }>();
    for (const d of [...byUpper, ...byRoll]) {
      const data = { ...(d.data() as StudentRecord), id: d.id };
      const key = rollNumberUpperOf(data.rollNumber);
      if (key && !studentByRoll.has(key)) studentByRoll.set(key, { ref: d.ref, data });
    }

    const plan: RollPlanItem[] = [];
    for (const roll of rolls) {
      const found = studentByRoll.get(roll);
      const manageable = found ? await canManage(found.data) : false;
      const student: RollStudent | undefined = found && {
        id: found.data.id, name: found.data.name, section: found.data.section, year: found.data.year,
        status: found.data.status, mentorUid: found.data.mentorUid, mentorName: found.data.mentorName,
      };
      plan.push(classifyRoll(roll, student, mentorUid, manageable));
    }
    const counts = { ...summarizeRollPlan(plan), repeatedInList: repeated };
    const ok = counts.problems === 0;
    const mentorSummary = { uid: mentorUid, name: mentor.name };
    if (!ok || mode === "validate") return NextResponse.json({ ok, mode, mentor: mentorSummary, plan, counts });

    const now = new Date();
    const writer = new ChunkedBatch(db);
    const assigned: string[] = [];
    for (const item of plan) {
      if (item.status !== "ASSIGN" || !item.studentId) continue;
      const found = studentByRoll.get(item.roll)!;
      writer.update(found.ref, { mentorUid, mentorName: mentor.name, mentorAssignedBy: session.uid, mentorAssignedAt: now });
      assigned.push(item.studentId);
    }
    await writer.commit();
    await announceMentorChange(db, session, { mentorUid, mentorName: mentor.name, studentIds: assigned });
    return NextResponse.json({ ok, mode, mentor: mentorSummary, plan, counts });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/assign-by-roll POST]");
  }
}
