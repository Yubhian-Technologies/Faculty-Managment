export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorName, bankAccess, guardError, loadOutcomes, midBankRefs, rulesForSubject } from "@/lib/midBank/server";
import { setupIssues } from "@/lib/midBank/setup";
import { bankTotals, unitStatuses } from "@/lib/midBank/rules";
import { MID_BANK_WRITE_ROLES } from "@/lib/midBank/server";
import type { MidQuestionBank, Subject } from "@/types";

// Starts the holder's bank: a snapshot of the Exam Cell rules (units, format,
// marks) is taken now, so later rule edits never reshape a bank being written.
// Idempotent - starting an already-started bank returns it unchanged.

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_BANK_WRITE_ROLES);
    const { id } = await params;
    const db = getAdminDb();
    const access = await bankAccess(db, session, id);
    if (!access) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    if (!access.isHolder) return NextResponse.json({ error: "Only the faculty assigned this question bank can start it" }, { status: 403 });
    const { assignment } = access;
    const refs = midBankRefs(db, session.collegeId);

    const subjectSnap = await refs.college.collection("subjects").doc(assignment.subjectId).get();
    if (!subjectSnap.exists) return NextResponse.json({ error: "The subject of this assignment no longer exists" }, { status: 404 });
    const subject = { id: subjectSnap.id, ...(subjectSnap.data() as Omit<Subject, "id">) };
    const [rules, outcomes] = await Promise.all([rulesForSubject(db, session.collegeId, subject), loadOutcomes(db, session.collegeId, subject.id)]);
    const { issues, units } = setupIssues(subject, assignment.midNumber, rules, outcomes);
    if (issues.length > 0 || !rules) return NextResponse.json({ error: issues[0]?.message ?? "Setup is incomplete", issues }, { status: 400 });

    const name = await actorName(db, session.collegeId, session.uid);
    const ref = refs.banks.doc(id);
    const bank = await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      if (cur.exists) return { id: cur.id, ...(cur.data() as Omit<MidQuestionBank, "id">) };
      const now = new Date();
      const unitStatus = unitStatuses(units, []);
      const totals = bankTotals(units, unitStatus);
      const data = {
        subjectId: subject.id, subjectName: subject.name, subjectCode: subject.code,
        midNumber: assignment.midNumber, facultyId: assignment.facultyId, department: assignment.department,
        units, format: rules.format, marks: rules.marks, unitStatus,
        status: "IN_PROGRESS" as const, completeCount: totals.completeCount, totalCount: totals.totalCount,
        startedBy: session.uid, startedByName: name, createdAt: now, updatedAt: now,
      };
      tx.set(ref, data);
      return { id, ...data };
    });
    return NextResponse.json({ bank }, { status: 201 });
  } catch (err) {
    return guardError(err, "[college/mid-question-banks/[id]/start POST]");
  }
}
