export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { patternForSubject } from "@/lib/midPapers/server";
import { withCurrentNames } from "@/lib/midPapers/pattern";
import { cachedCollectionDocs } from "@/lib/firestore/sharedReads";
import { paperBranchLabel, sectionCountsByBranch } from "@/lib/midBank/assignments";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import { checkSectionPick, claimIdFor, sectionsOf } from "@/lib/midBank/sections";
import {
  bankAccess, guardError, writeRefusal, MID_BANK_OVERSEERS, loadOutcomes, loadQuestions, loadSubject, loginUidsOf, MID_BANK_READ_ROLES, MID_BANK_WRITE_ROLES, midBankRefs, rulesForSubject, teachingFor, teachingForCached } from "@/lib/midBank/server";

// One question bank.
//   GET    everything the workspace / review need; the owner may write until the
//          deadline, colleagues whose sections it covers, the branch's HOD, the
//          Exam Cell and leadership read. Opening it never writes anything.
//   PATCH  { sectionIds }  the owner changes which sections it covers (claims move
//          in one transaction; questions are never touched).

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_BANK_READ_ROLES);
    const { id } = await params;
    const db = getAdminDb();
    const access = await bankAccess(db, session, id);
    if (!access) return NextResponse.json({ error: "Question bank not found. It may have been deleted." }, { status: 404 });
    if (!access.canRead) return NextResponse.json({ error: "This question bank isn't yours" }, { status: 403 });
    const { bank, deadline } = access;
    const subject = await loadSubject(db, session.collegeId, bank.subjectId);
    const [outcomes, rules, questions, departments] = await Promise.all([
      loadOutcomes(db, session.collegeId, bank.outcomesId),
      subject ? rulesForSubject(db, session.collegeId, subject) : null,
      loadQuestions(db, session.collegeId, id),
      cachedCollectionDocs(db, session.collegeId, "departments"),
    ]);
    // How the paper names its branches on the header (short codes; several branches each with their own sections).
    const codeOf = new Map(departments.map((x) => { const v = x.data() as { name?: string; code?: string }; return [v.name ?? "", v.code ?? ""]; }));
    // A branch whose every section the paper covers prints as its code alone.
    const totals = deadline ? sectionCountsByBranch(await teachingForCached(db, session.collegeId, deadline), bank.subjectId) : undefined;
    const branchLabel = paperBranchLabel(bank, (n) => codeOf.get(n) ?? "", totals);
    // Question papers: the answers (MCQ key, blanks) are for the owner, the HOD reviewing and the Exam Cell -
    // not for colleagues who only read the papers.
    const seesAnswers = access.isOwner || access.isHod || MID_BANK_OVERSEERS.includes(session.role);
    const shown = bank.kind === "PAPERS" && !seesAnswers
      ? questions.map((q) => { const { answer: _answer, ...rest } = q as typeof q & { answer?: string }; void _answer; return rest; })
      : questions;
    return NextResponse.json({
      // Part names (Name + Heading) follow the Exam Cell's current pattern on every paper (wording only).
      bank: bank.kind === "PAPERS" && bank.pattern && subject ? { ...bank, pattern: withCurrentNames(bank.pattern, await patternForSubject(db, session.collegeId, subject)) } : bank,
      deadline, outcomes, rules, questions: shown, branchLabel,
      subject: {
        id: bank.subjectId, name: bank.subjectName, code: bank.subjectCode, courseName: bank.courseName,
        regulation: subject?.regulation ?? "", year: bank.year, semester: bank.semester, branch: bank.branch,
        syllabusUrl: subject?.syllabusUrl ?? null, syllabusFileName: subject?.syllabusFileName ?? null,
      },
      access: { isOwner: access.isOwner, isIncluded: access.isIncluded, canWrite: access.canWrite, locked: access.locked, isHod: access.isHod, frozen: access.frozen, reviewDepartments: access.reviewDepartments,
        // The PDF of a paper is the Exam Cell's; faculty and HODs preview it on screen.
        canDownload: session.role === "EXAM_CELL" || session.role === "SUPER_ADMIN" },
    });
  } catch (err) {
    return guardError(err, "[college/mid-question-banks/[id] GET]");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_BANK_WRITE_ROLES);
    const { id } = await params;
    const body = (await readJsonBody(request)) as { sectionIds?: string[] };
    const db = getAdminDb();
    const access = await bankAccess(db, session, id);
    if (!access) return NextResponse.json({ error: "Question bank not found. It may have been deleted." }, { status: 404 });
    if (!access.isOwner) return NextResponse.json({ error: "Only the faculty preparing this bank can change its sections" }, { status: 403 });
    if (!access.canWrite || !access.deadline) return NextResponse.json({ error: writeRefusal(access) }, { status: 403 });
    const { bank, deadline } = access;
    if (bank.assignmentId) return NextResponse.json({ error: "Your HOD assigned this one - it covers every section of the assignment" }, { status: 409 });
    const refs = midBankRefs(db, session.collegeId);
    const available = sectionsOf(await teachingFor(db, session.collegeId, deadline), bank.subjectId, bank.branch);
    const before = new Set(bank.viewerFacultyIds);

    const result = await db.runTransaction(async (tx) => {
      const claimSnaps = await tx.getAll(...available.map((s) => refs.claims.doc(claimIdFor(deadline.id, bank.subjectId, s.sectionId))));
      const claims = new Map<string, string>();
      claimSnaps.forEach((c, i) => { if (c.exists && c.get("bankId") !== id) claims.set(available[i].sectionId, String(c.get("ownerName") ?? "another faculty member")); });
      const pick = checkSectionPick(available, body.sectionIds ?? [], bank.ownerFacultyId, claims);
      if (pick.error) return { status: 409, body: { error: pick.error } as Record<string, unknown> };
      const keep = new Set(pick.sections.map((s) => s.sectionId));
      const now = new Date();
      for (const s of bank.sections) if (!keep.has(s.sectionId)) tx.delete(refs.claims.doc(claimIdFor(deadline.id, bank.subjectId, s.sectionId)));
      for (const s of pick.sections) tx.set(refs.claims.doc(claimIdFor(deadline.id, bank.subjectId, s.sectionId)), { bankId: id, ownerFacultyId: bank.ownerFacultyId, ownerName: bank.ownerName, sectionId: s.sectionId, at: now });
      const viewerFacultyIds = [...new Set(pick.sections.flatMap((s) => s.facultyIds))];
      tx.update(refs.banks.doc(id), { sections: pick.sections, viewerFacultyIds, updatedAt: now });
      return { status: 200, body: { sections: pick.sections, viewerFacultyIds } as Record<string, unknown> };
    });

    if (result.status === 200) {
      const added = (result.body.viewerFacultyIds as string[]).filter((f) => !before.has(f));
      const uids = await loginUidsOf(db, session.collegeId, added);
      for (const f of added) {
        const uid = uids.get(f);
        if (uid) await notify(db, session.collegeId, uid, "MID_BANK_SHARED", `${bank.ownerName} is preparing your Mid ${bank.midNumber} ${bank.kind === "PAPERS" ? "question papers" : "question bank"}`,
          `${bank.subjectName} (${bank.branch}) - your section is now covered by ${bank.ownerName}'s ${bank.kind === "PAPERS" ? "question papers" : "question bank"}. You can view it under ${bank.kind === "PAPERS" ? "Mid Question Papers" : "Mid Question Bank"}.`, "/panel/mid-bank");
      }
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-question-banks/[id] PATCH]");
  }
}
