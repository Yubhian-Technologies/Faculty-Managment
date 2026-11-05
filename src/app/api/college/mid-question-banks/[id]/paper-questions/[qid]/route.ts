export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorName, bankAccess, guardError, loadOutcomes, MID_BANK_WRITE_ROLES, midBankRefs, writeRefusal } from "@/lib/midBank/server";
import { textKey } from "@/lib/midBank/duplicates";
import { outcomeSwitches } from "@/lib/midBank/outcomeSwitches";
import { cleanPaperQuestion, unitOfQuestion, FLEXIBLE_MAX_QUESTIONS, flexibleQuestions, paperProgress, paperQuestionErrors, questionId, questionTexts } from "@/lib/midPapers/pattern";
import type { MidPaperQuestion, MidQuestionBank } from "@/types";

// Saves one question of a faculty member's question papers (qid = `${set}_${partId}_${no}`).
//   { action: "draft",    question, baseRev }  keeps whatever is written, unchecked
//   { action: "complete", question, baseRev }  must pass the part's checks (and COs / Bloom when the college uses them)
// One transaction: `baseRev` must be the question's current rev (else 409 - never overwritten), an exact copy of
// another question of the same set is refused (warned across sets), and each set's progress is recomputed.
// A draft with nothing written clears the slot. A part the faculty build themselves (flexible): each question
// carries its own kind + whole marks, a new one is added after the last, and { action: "remove" } deletes one and
// moves the later ones up. Only the owner, before the deadline, while not with the HOD.

type Params = { params: Promise<{ id: string; qid: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_BANK_WRITE_ROLES);
    const { id, qid } = await params;
    const body = (await readJsonBody(request)) as { action?: string; question?: unknown; baseRev?: number };
    const action = body.action === "complete" ? "complete" : body.action === "draft" ? "draft" : body.action === "remove" ? "remove" : null;
    if (!action) return NextResponse.json({ error: "action must be draft, complete or remove" }, { status: 400 });

    const db = getAdminDb();
    const access = await bankAccess(db, session, id);
    if (!access || access.bank.kind !== "PAPERS" || !access.bank.pattern) return NextResponse.json({ error: "Question papers not found" }, { status: 404 });
    if (!access.isOwner) return NextResponse.json({ error: "Only the faculty preparing these question papers can edit them" }, { status: 403 });
    if (!access.canWrite) return NextResponse.json({ error: writeRefusal(access).replace("question bank", "question papers") }, { status: 403 });

    const pattern = access.bank.pattern;
    const m = /^(\d)_([A-F])_(\d{1,2})$/.exec(qid);
    const set = m ? Number(m[1]) : 0, partId = m?.[2] ?? "", no = m ? Number(m[3]) : 0;
    const part = pattern.parts.find((p) => p.id === partId);
    // A fixed part has its set number of questions; a faculty-decides part as many as the faculty write (checked below).
    if (!m || !part || set < 1 || set > pattern.setsPerFaculty || no < 1 || (!part.flexible && no > part.questions) || no > FLEXIBLE_MAX_QUESTIONS) return NextResponse.json({ error: "Unknown question" }, { status: 400 });
    if (action === "remove" && !part.flexible) return NextResponse.json({ error: "Only a question of a part you build yourself can be removed" }, { status: 400 });

    const sw = outcomeSwitches(access.bank.outcomes);
    const outcomes = sw.cos ? await loadOutcomes(db, session.collegeId, access.bank.outcomesId) : null;
    const coIds = new Set((outcomes?.cos ?? []).map((c) => c.id));
    const name = await actorName(db, session.collegeId, session.uid);
    const refs = midBankRefs(db, session.collegeId);
    const bankRef = refs.banks.doc(id);
    const qRef = refs.questions(id).doc(qid);

    const result = await db.runTransaction(async (tx) => {
      const bankSnap = await tx.get(bankRef);
      const bank = bankSnap.data() as MidQuestionBank | undefined;
      if (!bank) return { status: 404, body: { error: "Question papers not found" } };
      if (bank.approval === "SUBMITTED" || bank.approval === "APPROVED") return { status: 409, body: { error: writeRefusal({ frozen: true, bank }).replace("question bank", "question papers") } };
      const all = (await tx.get(refs.questions(id))).docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MidPaperQuestion, "id">) }));
      const current = all.find((q) => q.id === qid) ?? null;
      const rev = current?.rev ?? 0;
      const inPart = flexibleQuestions(all, set, partId);
      // Faculty-decides part: questions are 1..n with no gaps - a new one goes right after the last.
      if (part.flexible && !current && no !== inPart.length + 1) return { status: 409, body: { error: "The questions of this part changed in another tab - reload it", question: null } };
      if (action === "remove") {
        if (!current) return { status: 200, body: { question: null, warnings: [] } };
        // Later questions move up one (their ids follow their number).
        const after = inPart.filter((q) => q.no > no);
        // Each later question is written one place up (each document written once), then the last slot goes.
        for (const q of after) {
          const { id: _old, ...data } = q; void _old;
          tx.set(refs.questions(id).doc(questionId(set, partId, q.no - 1)), { ...data, no: q.no - 1 });
        }
        tx.delete(refs.questions(id).doc(questionId(set, partId, inPart.length)));
        const rest = all.filter((q) => q.id !== qid).map((q) => (q.set === set && q.partId === partId && q.no > no ? { ...q, no: q.no - 1, id: questionId(set, partId, q.no - 1) } : q));
        const p = paperProgress(pattern, rest);
        tx.update(bankRef, { setProgress: p.setProgress, completeCount: p.completeCount, totalCount: p.totalCount, status: p.allComplete ? "COMPLETE" : "IN_PROGRESS", updatedAt: new Date() });
        return { status: 200, body: { removed: qid, renumbered: after.map((q) => q.id), progress: p, warnings: [] } };
      }
      if (Number(body.baseRev ?? 0) !== rev) return { status: 409, body: { error: "This question was changed in another tab or window - reload it before saving", question: current } };

      const q = cleanPaperQuestion(body.question, part, coIds);
      // A per-unit part: each question belongs to its unit (by position), whatever the editor sent.
      const unitOf = unitOfQuestion(part, access.bank.units ?? [], no);
      if (unitOf) q.unit = unitOf;
      const keys = questionTexts(q).map(textKey).filter(Boolean);
      const others = all.filter((x) => x.id !== qid);
      const sameSet = others.filter((x) => x.set === set && x.textKeys?.some((k) => keys.includes(k)));
      const otherSets = others.filter((x) => x.set !== set && x.textKeys?.some((k) => keys.includes(k)));
      const warnings = otherSets.map((x) => `The same question is in Set ${x.set} (${x.partId}${x.no})`);

      let state: MidPaperQuestion["state"] = "DRAFT";
      if (action === "complete") {
        const errors = paperQuestionErrors(q, part, sw);
        if (sameSet.length) errors.push(`The same question is already in this set (${sameSet[0].partId}${sameSet[0].no})`);
        if (errors.length) return { status: 400, body: { error: errors[0], errors } };
        state = "COMPLETE";
      } else if (!part.flexible && !keys.length && !q.imageUrl && !(q.options ?? []).some((o) => o.trim()) && !q.answer) {
        // Clearing an empty slot.
        if (!current) return { status: 200, body: { question: null, warnings: [] } };
        tx.delete(qRef);
        const p = paperProgress(pattern, others);
        tx.update(bankRef, { setProgress: p.setProgress, completeCount: p.completeCount, totalCount: p.totalCount, status: p.allComplete ? "COMPLETE" : "IN_PROGRESS", updatedAt: new Date() });
        return { status: 200, body: { question: null, progress: p, warnings: [] } };
      }

      const next: Omit<MidPaperQuestion, "id"> = {
        set, partId, no, ...q, state, rev: rev + 1, textKeys: keys,
        updatedBy: session.uid, updatedByName: name, updatedAt: new Date() as unknown as MidPaperQuestion["updatedAt"],
      };
      // Firestore rejects undefined values.
      const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
      tx.set(qRef, clean);
      const p = paperProgress(pattern, [...others, { ...next, id: qid }]);
      tx.update(bankRef, { setProgress: p.setProgress, completeCount: p.completeCount, totalCount: p.totalCount, status: p.allComplete ? "COMPLETE" : "IN_PROGRESS", updatedAt: new Date() });
      return { status: 200, body: { question: { id: qid, ...clean }, progress: p, warnings } };
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-question-banks/[id]/paper-questions PATCH]");
  }
}
