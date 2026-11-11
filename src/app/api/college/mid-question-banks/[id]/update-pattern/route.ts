export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { bankAccess, guardError, MID_BANK_WRITE_ROLES, midBankRefs, writeRefusal } from "@/lib/midBank/server";
import { livePaperLayout, loadPaperQuestions } from "@/lib/midPapers/server";
import { paperProgress, remapQuestions } from "@/lib/midPapers/pattern";
import type { MidPaperQuestion, MidQuestionBank } from "@/types";

// A started question paper keeps the pattern it started with. When the Exam Cell changes the pattern (or the units
// per Mid) afterwards, the owner can move the paper onto the current one:
//   GET   what would change (and which written questions would have no place, each with why - then it is refused)
//   POST  do it: every question moves to its place (a per-unit question stays in its unit), in one transaction.
// Nothing written is ever dropped; before the deadline, and not while it is with the HOD.

type Params = { params: Promise<{ id: string }> };

async function plan(db: FirebaseFirestore.Firestore, session: { uid: string; role: string; collegeId: string }, id: string) {
  const access = await bankAccess(db, session, id);
  if (!access || access.bank.kind !== "PAPERS" || !access.bank.pattern) return { error: "Question papers not found", status: 404 } as const;
  if (!access.isOwner) return { error: "Only the faculty preparing these question papers can update them", status: 403 } as const;
  if (!access.canWrite) return { error: writeRefusal(access).replace("question bank", "question papers"), status: 403 } as const;
  const live = await livePaperLayout(db, session.collegeId, access.bank);
  if (!live) return { error: "The Exam Cell has no question paper pattern for this subject now", status: 409 } as const;
  if (live.issues.length) return { error: live.issues[0].message, status: 409 } as const;
  const questions = await loadPaperQuestions(db, session.collegeId, id);
  const remap = remapQuestions(access.bank.pattern, live.pattern, questions, access.bank.units ?? []);
  return { access, live, questions, remap } as const;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_BANK_WRITE_ROLES);
    const { id } = await params;
    const p = await plan(getAdminDb(), session, id);
    if ("error" in p) return NextResponse.json({ error: p.error }, { status: p.status });
    return NextResponse.json({ changed: p.live.changed, dropped: p.remap.dropped, reasons: p.remap.reasons, parts: p.live.pattern.parts.map((x) => ({ label: x.label, questions: x.questions, unitLayout: x.unitLayout ?? null })) });
  } catch (err) {
    return guardError(err, "[college/mid-question-banks/[id]/update-pattern GET]");
  }
}

export async function POST(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_BANK_WRITE_ROLES);
    const { id } = await params;
    const db = getAdminDb();
    const p = await plan(db, session, id);
    if ("error" in p) return NextResponse.json({ error: p.error }, { status: p.status });
    if (!p.live.changed) return NextResponse.json({ ok: true, unchanged: true });
    if (p.remap.dropped.length) {
      return NextResponse.json({ error: `${p.remap.dropped.length} written question${p.remap.dropped.length === 1 ? " has" : "s have"} no place in the new pattern (${p.remap.dropped.join(", ")}) - clear ${p.remap.dropped.length === 1 ? "it" : "them"} first` }, { status: 409 });
    }
    const refs = midBankRefs(db, session.collegeId);
    const bankRef = refs.banks.doc(id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(bankRef);
      const bank = snap.data() as MidQuestionBank | undefined;
      if (!bank || bank.withdrawn || bank.approval === "SUBMITTED" || bank.approval === "APPROVED") throw new Error("FROZEN");
      const byId = new Map(p.questions.map((q) => [q.id, q]));
      const targets = new Set(p.remap.moves.map((m) => m.to));
      const moved: MidPaperQuestion[] = [];
      // Every question written once at its new place; old places nothing moves into are deleted.
      for (const m of p.remap.moves) {
        const q = byId.get(m.from)!;
        // id = set_partId_no; a question may move to another part (a removed "own questions" part -> the CEA paper).
        const bits = m.to.split("_");
        const no = Number(bits[bits.length - 1]);
        const partId = bits.slice(1, -1).join("_");
        const { id: _old, ...data } = q; void _old;
        if (m.from !== m.to) tx.set(refs.questions(id).doc(m.to), { ...data, partId, no });
        moved.push({ ...q, id: m.to, partId, no });
      }
      for (const m of p.remap.moves) if (m.from !== m.to && !targets.has(m.from)) tx.delete(refs.questions(id).doc(m.from));
      // A setter writing only some papers (shared by the HOD) keeps that share.
      const nextPattern = bank.pattern?.sets?.length ? { ...p.live.pattern, sets: bank.pattern.sets } : p.live.pattern;
      const prog = paperProgress(nextPattern, moved);
      tx.update(bankRef, {
        pattern: nextPattern, units: p.live.units, setProgress: prog.setProgress, completeCount: prog.completeCount, totalCount: prog.totalCount,
        status: prog.allComplete ? "COMPLETE" : "IN_PROGRESS", updatedAt: new Date(),
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "FROZEN") return NextResponse.json({ error: "These question papers are with the HOD - withdraw them first" }, { status: 409 });
    return guardError(err, "[college/mid-question-banks/[id]/update-pattern POST]");
  }
}
