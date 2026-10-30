export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { isDeadlineLocked } from "@/lib/midBank/deadline";
import { setupIssues } from "@/lib/midBank/setup";
import { bankIdFor, claimIdFor, outcomesIdFor, sectionsOf } from "@/lib/midBank/sections";
import { guardError, subjectSplitFor, loadDeadline, loadOutcomes, loadSubject, MID_BANK_WRITE_ROLES, midBankRefs, rulesForSubject, teachingFor, usedOutcomeRefs } from "@/lib/midBank/server";

// What the setup screen needs before (or while changing) a bank for one
// deadline + subject + branch: the subject, the Exam Cell rules, the branch's
// units / COs / mapping, every section of the subject in the branch with who
// teaches and holds it, and whether the caller may edit the setup. Reads only.
//   ?deadlineId=&subjectId=&branch=

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...MID_BANK_WRITE_ROLES);
    const q = new URL(request.url).searchParams;
    const deadlineId = q.get("deadlineId") ?? "", subjectId = q.get("subjectId") ?? "", branch = q.get("branch") ?? "";
    const db = getAdminDb();
    const [d, subject, me] = await Promise.all([
      loadDeadline(db, session.collegeId, deadlineId),
      loadSubject(db, session.collegeId, subjectId),
      resolveFacultyMemberId(db, session.collegeId, session.uid),
    ]);
    if (!d || !subject) return NextResponse.json({ error: "This question bank isn't open" }, { status: 404 });
    const rows = await teachingFor(db, session.collegeId, d);
    const available = sectionsOf(rows, subjectId, branch);
    if (!available.some((s) => s.facultyIds.includes(me))) return NextResponse.json({ error: "You don't teach this subject in this branch" }, { status: 403 });

    const refs = midBankRefs(db, session.collegeId);
    const outcomesId = outcomesIdFor(subjectId, branch);
    const myBankId = bankIdFor(d.id, subjectId, branch, me);
    const [rules, outcomes, claimSnaps, myBank, used, exception] = await Promise.all([
      rulesForSubject(db, session.collegeId, subject),
      loadOutcomes(db, session.collegeId, outcomesId),
      db.getAll(...available.map((s) => refs.claims.doc(claimIdFor(d.id, subjectId, s.sectionId)))),
      refs.banks.doc(myBankId).get(),
      usedOutcomeRefs(db, session.collegeId, outcomesId),
      subjectSplitFor(db, session.collegeId, subjectId),
    ]);
    const sections = available.map((s, i) => ({
      ...s, mine: s.facultyIds.includes(me),
      heldBy: claimSnaps[i]?.exists ? String(claimSnaps[i].get("ownerName") ?? "") : null,
      heldByMe: claimSnaps[i]?.exists ? claimSnaps[i].get("bankId") === myBankId : false,
    }));
    // The setup belongs to whoever entered it first; owners of the subject's banks in
    // this branch may change it too (never removing a unit / CO that questions use).
    const inUse = used.units.size > 0 || used.cos.size > 0;
    const canEditOutcomes = !outcomes || outcomes.updatedBy === session.uid || used.owners.has(me) || (!inUse && sections.some((s) => s.mine));

    return NextResponse.json({
      deadline: { ...d, locked: isDeadlineLocked(d.deadline) },
      subject: { id: subject.id, name: subject.name, code: subject.code, courseName: subject.courseName ?? d.courseName, regulation: subject.regulation ?? "", year: d.year, semester: d.semester },
      branch, outcomesId, outcomes, rules, sections,
      setup: setupIssues(subject, d.midNumber, rules, outcomes, exception),
      myBankId: myBank.exists ? myBankId : null,
      canEditOutcomes,
    });
  } catch (err) {
    return guardError(err, "[college/mid-question-banks/prepare GET]");
  }
}
