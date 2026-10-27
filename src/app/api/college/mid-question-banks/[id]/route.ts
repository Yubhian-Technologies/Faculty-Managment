export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import { checkSectionPick, claimIdFor, sectionsOf } from "@/lib/midBank/sections";
import {
  bankAccess, guardError, loadOutcomes, loadQuestions, loadSubject, loginUidsOf, MID_BANK_READ_ROLES, MID_BANK_WRITE_ROLES, midBankRefs, rulesForSubject, teachingFor,
} from "@/lib/midBank/server";

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
    if (!access) return NextResponse.json({ error: "Question bank not found" }, { status: 404 });
    if (!access.canRead) return NextResponse.json({ error: "This question bank isn't yours" }, { status: 403 });
    const { bank, deadline } = access;
    const subject = await loadSubject(db, session.collegeId, bank.subjectId);
    const [outcomes, rules, questions] = await Promise.all([
      loadOutcomes(db, session.collegeId, bank.outcomesId),
      subject ? rulesForSubject(db, session.collegeId, subject) : null,
      loadQuestions(db, session.collegeId, id),
    ]);
    return NextResponse.json({
      bank, deadline, outcomes, rules, questions,
      subject: {
        id: bank.subjectId, name: bank.subjectName, code: bank.subjectCode, courseName: bank.courseName,
        regulation: subject?.regulation ?? "", year: bank.year, semester: bank.semester, branch: bank.branch,
      },
      access: { isOwner: access.isOwner, isIncluded: access.isIncluded, canWrite: access.canWrite, locked: access.locked },
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
    if (!access) return NextResponse.json({ error: "Question bank not found" }, { status: 404 });
    if (!access.isOwner) return NextResponse.json({ error: "Only the faculty preparing this bank can change its sections" }, { status: 403 });
    if (!access.canWrite || !access.deadline) return NextResponse.json({ error: "The deadline has passed - ask the Exam Cell to extend it" }, { status: 403 });
    const { bank, deadline } = access;
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
        if (uid) await notify(db, session.collegeId, uid, "MID_BANK_SHARED", `${bank.ownerName} is preparing your Mid ${bank.midNumber} question bank`,
          `${bank.subjectName} (${bank.branch}) - your section is now covered by ${bank.ownerName}'s question bank. You can view it under Question Bank.`, "/panel/mid-bank");
      }
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-question-banks/[id] PATCH]");
  }
}
