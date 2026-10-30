export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorName, bankAccess, guardError, loadOutcomes, loadSubject, MID_BANK_WRITE_ROLES, midBankRefs, rulesForSubject } from "@/lib/midBank/server";
import { allowedFormats, bankFormats, cleanParts, formatOf, formatsFor, isBlankPart, partLabel, questionErrors, questionFormat } from "@/lib/midBank/validateQuestion";
import { findDuplicates, textKey } from "@/lib/midBank/duplicates";
import { bankTotals, breaksCompletedUnit, lockReason, unitStatus } from "@/lib/midBank/rules";
import { QUESTIONS_PER_UNIT } from "@/lib/midBank/constants";
import type { MidQuestion, MidQuestionBank } from "@/types";

// Saves one question slot of a bank (qid = `${unit}_${slot}`).
//   { action: "draft",    parts, baseRev }  keeps whatever is written, unchecked
//   { action: "complete", parts, baseRev }  must pass every academic check
// `format` is the question's own type, one of those the bank allows (else the bank's first).
// In one transaction: the unit must be open (units go in order), `baseRev`
// must be the question's current rev (else 409 - it changed elsewhere and is
// never overwritten), an exact duplicate is refused, and a complete unit may
// not be turned back. The bank's unit progress is recomputed in the same write.
// A draft whose parts are all empty clears the slot.

type Params = { params: Promise<{ id: string; qid: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_BANK_WRITE_ROLES);
    const { id, qid } = await params;
    const body = (await readJsonBody(request)) as { action?: string; format?: string; parts?: unknown; baseRev?: number };
    const action = body.action === "complete" ? "complete" : body.action === "draft" ? "draft" : null;
    if (!action) return NextResponse.json({ error: "action must be draft or complete" }, { status: 400 });
    const m = /^(\d{1,2})_(\d{1,2})$/.exec(qid);
    if (!m) return NextResponse.json({ error: "Unknown question" }, { status: 400 });
    const unit = Number(m[1]), slot = Number(m[2]);
    if (slot < 1 || slot > QUESTIONS_PER_UNIT) return NextResponse.json({ error: "Unknown question" }, { status: 400 });

    const db = getAdminDb();
    const access = await bankAccess(db, session, id);
    if (!access) return NextResponse.json({ error: "Question bank not found" }, { status: 404 });
    if (!access.isOwner) return NextResponse.json({ error: "Only the faculty preparing this question bank can edit it" }, { status: 403 });
    if (!access.canWrite) return NextResponse.json({ error: "The deadline has passed - this question bank is locked. Ask the Exam Cell to extend it." }, { status: 403 });
    const [outcomes, subject] = await Promise.all([
      loadOutcomes(db, session.collegeId, access.bank.outcomesId),
      loadSubject(db, session.collegeId, access.bank.subjectId),
    ]);
    // The question types follow the Exam Cell's current rule (see bankFormats).
    const liveRules = subject ? await rulesForSubject(db, session.collegeId, subject) : null;
    const coIds = new Set((outcomes?.cos ?? []).map((c) => c.id));
    const name = await actorName(db, session.collegeId, session.uid);

    const refs = midBankRefs(db, session.collegeId);
    const bankRef = refs.banks.doc(id);
    const qRef = refs.questions(id).doc(qid);

    type Result =
      | { status: number; body: Record<string, unknown> }
      | { status: 200; body: Record<string, unknown> };
    const result: Result = await db.runTransaction(async (tx) => {
      const bankSnap = await tx.get(bankRef);
      if (!bankSnap.exists) return { status: 400, body: { error: "Start the question bank first" } };
      const bank = bankSnap.data() as MidQuestionBank;
      if (!bank.units.includes(unit)) return { status: 400, body: { error: `Mid ${bank.midNumber} doesn't cover Unit ${unit}` } };
      const locked = lockReason(bank.units, bank.unitStatus, unit);
      if (locked) return { status: 403, body: { error: `Unit ${unit} is locked - ${locked.toLowerCase()}` } };

      const all = (await tx.get(refs.questions(id))).docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MidQuestion, "id">) }));
      const current = all.find((q) => q.id === qid) ?? null;
      const rev = current?.rev ?? 0;
      if (Number(body.baseRev ?? 0) !== rev) {
        return { status: 409, body: { error: "This question was changed in another tab or window - reload it before saving", question: current } };
      }

      const allowed = bankFormats(bank, liveRules);
      const format = questionFormat(formatsFor(allowed, current ? formatOf(current, allowedFormats(bank)) : null), body.format);
      const parts = cleanParts(body.parts, format, coIds, bank.marks);
      const keys = parts.map((p) => textKey(p.text));
      const others = all.filter((q) => q.id !== qid);
      const dup = findDuplicates(keys, others);
      const warnings = dup.similar.map((h) => `${partLabel(format, h.part)} looks similar to Unit ${h.unit} Q${h.slot}`);

      let state: MidQuestion["state"];
      if (action === "complete") {
        const errors = questionErrors(parts, format, bank.marks);
        for (const h of dup.exact) {
          errors[`parts.${h.part}.text`] = h.id
            ? `${partLabel(format, h.part)} is the same as Unit ${h.unit} Q${h.slot}`
            : "Parts (a) and (b) are the same question";
        }
        if (Object.keys(errors).length > 0) return { status: 400, body: { error: Object.values(errors)[0], errors } };
        state = "COMPLETE";
      } else {
        if (parts.every(isBlankPart)) {
          // Clearing an empty slot.
          if (!current) return { status: 200, body: { question: null, unitStatus: bank.unitStatus[String(unit)], warnings: [] } };
          if (current.state === "COMPLETE") {
            const after = unitStatus(others, unit);
            const broken = breaksCompletedUnit(bank.unitStatus[String(unit)], after);
            if (broken) return { status: 409, body: { error: broken } };
          }
          tx.delete(qRef);
          const statuses = { ...bank.unitStatus, [String(unit)]: unitStatus(others, unit) };
          const totals = bankTotals(bank.units, statuses);
          tx.update(bankRef, { unitStatus: statuses, completeCount: totals.completeCount, totalCount: totals.totalCount, status: totals.allComplete ? "COMPLETE" : "IN_PROGRESS", updatedAt: new Date() });
          return { status: 200, body: { question: null, unitStatus: statuses[String(unit)], bank: { ...totals, status: totals.allComplete ? "COMPLETE" : "IN_PROGRESS" }, warnings: [] } };
        }
        state = "DRAFT";
      }

      const next: Omit<MidQuestion, "id"> = {
        unit, slot, format, parts, state, rev: rev + 1, textKeys: keys,
        updatedBy: session.uid, updatedByName: name, updatedAt: new Date() as unknown as MidQuestion["updatedAt"],
      };
      const after = unitStatus([...others, { ...next, id: qid }], unit);
      const broken = breaksCompletedUnit(bank.unitStatus[String(unit)], after);
      if (broken) return { status: 409, body: { error: broken } };

      tx.set(qRef, next);
      const statuses = { ...bank.unitStatus, [String(unit)]: after };
      const totals = bankTotals(bank.units, statuses);
      const status = totals.allComplete ? "COMPLETE" : "IN_PROGRESS";
      tx.update(bankRef, { unitStatus: statuses, completeCount: totals.completeCount, totalCount: totals.totalCount, status, updatedAt: new Date() });
      return { status: 200, body: { question: { id: qid, ...next }, unitStatus: after, bank: { ...totals, status }, warnings } };
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-question-banks/[id]/questions/[qid] PATCH]");
  }
}
