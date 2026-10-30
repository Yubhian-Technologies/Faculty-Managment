export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { isDeadlineLocked } from "@/lib/midBank/deadline";
import { cleanOutcomes, outcomeConflicts } from "@/lib/midBank/outcomes";
import { outcomesIdFor, sectionsOf } from "@/lib/midBank/sections";
import { actorName, guardError, loadDeadline, loadOutcomes, loadSubject, MID_BANK_READ_ROLES, MID_BANK_WRITE_ROLES, midBankRefs, teachingFor, usedOutcomeRefs } from "@/lib/midBank/server";
import type { SubjectOutcomes } from "@/types";

// A subject's units, Course Outcomes, PSOs and CO -> PO/PSO mapping in ONE
// branch (id = `${subjectId}__${branchKey}`), entered in the question bank setup
// by whoever prepares first and reused by every later bank (Mid 2 included).
//  - a faculty member teaching the subject in that branch may enter it, and edit
//    it while no question uses it;
//  - once questions use it, only its author and the owners of those banks may
//    edit, and never so that a unit or CO a question uses disappears.

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_BANK_READ_ROLES);
    const { id } = await params;
    return NextResponse.json({ outcomes: await loadOutcomes(getAdminDb(), session.collegeId, id) });
  } catch (err) {
    return guardError(err, "[college/subject-outcomes GET]");
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_BANK_WRITE_ROLES);
    const { id } = await params;
    const body = (await readJsonBody(request)) as { deadlineId?: string; subjectId?: string; branch?: string; baseVersion?: number } & Record<string, unknown>;
    const subjectId = String(body.subjectId ?? ""), branch = String(body.branch ?? "");
    if (!subjectId || !branch || outcomesIdFor(subjectId, branch) !== id) return NextResponse.json({ error: "Unknown subject setup" }, { status: 400 });
    const db = getAdminDb();
    const [d, subject, me] = await Promise.all([
      loadDeadline(db, session.collegeId, String(body.deadlineId ?? "")),
      loadSubject(db, session.collegeId, subjectId),
      resolveFacultyMemberId(db, session.collegeId, session.uid),
    ]);
    if (!d || !subject) return NextResponse.json({ error: "This question bank isn't open" }, { status: 404 });
    if (isDeadlineLocked(d.deadline)) return NextResponse.json({ error: "The deadline has passed - ask the Exam Cell to extend it" }, { status: 403 });
    const teaches = sectionsOf(await teachingFor(db, session.collegeId, d), subjectId, branch).some((s) => s.facultyIds.includes(me));
    if (!teaches) return NextResponse.json({ error: "Only faculty teaching this subject in this branch can set it up" }, { status: 403 });

    const { value, errors } = cleanOutcomes(body);
    if (errors.length > 0) return NextResponse.json({ error: errors[0], errors }, { status: 400 });

    const current = await loadOutcomes(db, session.collegeId, id);
    const used = await usedOutcomeRefs(db, session.collegeId, id);
    const inUse = used.units.size > 0 || used.cos.size > 0;
    if (current && inUse && current.updatedBy !== session.uid && !used.owners.has(me)) {
      return NextResponse.json({ error: `${current.updatedByName || "A colleague"} set this up and questions already use it - ask them to change it` }, { status: 403 });
    }
    const conflicts = outcomeConflicts(value, used);
    if (conflicts.length > 0) return NextResponse.json({ error: conflicts[0], errors: conflicts }, { status: 409 });

    const name = await actorName(db, session.collegeId, session.uid);
    const ref = midBankRefs(db, session.collegeId).outcomes.doc(id);
    const saved = await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      const c = cur.exists ? (cur.data() as SubjectOutcomes) : null;
      if ((c?.version ?? 0) !== Number(body.baseVersion ?? 0)) return null;
      const now = new Date();
      const data = {
        subjectId, branch, subjectName: subject.name, subjectCode: subject.code, ...value,
        version: (c?.version ?? 0) + 1, updatedBy: session.uid, updatedByName: name, updatedAt: now, createdAt: c?.createdAt ?? now,
      };
      tx.set(ref, data);
      return data;
    });
    if (!saved) return NextResponse.json({ error: "Someone else saved this setup meanwhile - reload to see their version" }, { status: 409 });
    return NextResponse.json({ outcomes: saved });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/subject-outcomes PUT]");
  }
}
