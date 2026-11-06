export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { loadMidSettings } from "@/lib/exams/midSettings";
import { patternForSubject } from "@/lib/midPapers/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { isDeadlineLocked } from "@/lib/midBank/deadline";
import { paperSetupIssues, setupIssues } from "@/lib/midBank/setup";
import { bankIdFor, claimIdFor, outcomesIdFor, sectionsOf } from "@/lib/midBank/sections";
import { assignmentIdFor, sectionsForScope } from "@/lib/midBank/assignments";
import { assignmentsCol } from "@/lib/midBank/assignmentsServer";
import type { MidBankAssignment } from "@/types";
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
    // A bare /panel/mid-bank/prepare (e.g. a bookmark, or a link that lost its query) - say so, don't crash on doc("").
    if (!deadlineId || !subjectId || !branch) return NextResponse.json({ error: "Open the question bank from the Question Bank list" }, { status: 400 });
    const db = getAdminDb();
    const [d, subject, me] = await Promise.all([
      loadDeadline(db, session.collegeId, deadlineId),
      loadSubject(db, session.collegeId, subjectId),
      resolveFacultyMemberId(db, session.collegeId, session.uid),
    ]);
    if (!d || !subject) return NextResponse.json({ error: "This question bank isn't open" }, { status: 404 });
    const [rows, settings0] = await Promise.all([teachingFor(db, session.collegeId, d), loadMidSettings(db, session.collegeId)]);
    // "The HOD assigns": only an assigned setter prepares it, for every section of the scope (a branch or all).
    const hodMode = settings0.midAssignment === "HOD";
    const assignment = hodMode
      ? (await assignmentsCol(db, session.collegeId).doc(assignmentIdFor(deadlineId, subjectId, branch)).get()).data() as MidBankAssignment | undefined
      : undefined;
    const available = hodMode ? sectionsForScope(rows, subjectId, branch) : sectionsOf(rows, subjectId, branch);
    if (hodMode) {
      if (!assignment?.facultyIds.includes(me)) return NextResponse.json({ error: "Your HOD hasn't assigned you to prepare this subject" }, { status: 403 });
    } else if (!available.some((s) => s.facultyIds.includes(me))) return NextResponse.json({ error: "You don't teach this subject in this branch" }, { status: 403 });

    const refs = midBankRefs(db, session.collegeId);
    const outcomesId = outcomesIdFor(subjectId, branch);
    const myBankId = bankIdFor(d.id, subjectId, branch, me);
    const [rules, outcomes, claimSnaps, myBank, used, exception] = await Promise.all([
      rulesForSubject(db, session.collegeId, subject),
      loadOutcomes(db, session.collegeId, outcomesId),
      // Assigned setters don't claim sections (several may prepare for the same sections).
      hodMode || available.length === 0 ? Promise.resolve([]) : db.getAll(...available.map((s) => refs.claims.doc(claimIdFor(d.id, subjectId, s.sectionId)))),
      refs.banks.doc(myBankId).get(),
      usedOutcomeRefs(db, session.collegeId, outcomesId),
      subjectSplitFor(db, session.collegeId, subjectId),
    ]);
    const settings = settings0;
    // A college that prepares question papers works to the Exam Cell's paper pattern instead of the bank rules.
    const pattern = settings.midPreparation === "PAPERS" ? await patternForSubject(db, session.collegeId, subject) : null;
    const sections = available.map((s, i) => ({
      ...s, mine: s.facultyIds.includes(me),
      heldBy: hodMode ? null : claimSnaps[i]?.exists ? String(claimSnaps[i].get("ownerName") ?? "") : null,
      heldByMe: hodMode ? myBank.exists : claimSnaps[i]?.exists ? claimSnaps[i].get("bankId") === myBankId : false,
    }));
    // The setup belongs to whoever entered it first; owners of the subject's banks in
    // this branch may change it too (never removing a unit / CO that questions use).
    const inUse = used.units.size > 0 || used.cos.size > 0;
    const canEditOutcomes = !outcomes || outcomes.updatedBy === session.uid || used.owners.has(me) || (!inUse && (hodMode ? true : sections.some((s) => s.mine)));

    return NextResponse.json({
      deadline: { ...d, locked: isDeadlineLocked(d.deadline) },
      subject: { id: subject.id, name: subject.name, code: subject.code, courseName: subject.courseName ?? d.courseName, regulation: subject.regulation ?? "", year: d.year, semester: d.semester, syllabusUrl: subject.syllabusUrl ?? null, syllabusFileName: subject.syllabusFileName ?? null },
      branch, outcomesId, outcomes, rules, sections,
      setup: settings.midPreparation === "PAPERS"
        ? paperSetupIssues(subject, pattern, outcomes, settings.outcomes, { midNumber: d.midNumber, rules, exception, midCount: settings.midCount })
        : setupIssues(subject, d.midNumber, rules, outcomes, exception, settings.outcomes),
      outcomeSwitches: settings.outcomes, midPreparation: settings.midPreparation, pattern,
      myBankId: myBank.exists ? myBankId : null,
      assignment: assignment ? { scope: assignment.scope, assignedByName: assignment.assignedByName, facultyNames: assignment.facultyNames, branches: assignment.branches } : null,
      canEditOutcomes,
    });
  } catch (err) {
    return guardError(err, "[college/mid-question-banks/prepare GET]");
  }
}
