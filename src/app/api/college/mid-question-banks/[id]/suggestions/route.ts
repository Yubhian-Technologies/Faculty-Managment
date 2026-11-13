export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import { actorName, bankAccess, guardError, MID_BANK_READ_ROLES, midBankRefs } from "@/lib/midBank/server";
import { FieldValue } from "firebase-admin/firestore";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import type { MidBankApprovalEntry, MidBankSuggestion, MidQuestionBank } from "@/types";

// Suggestions on a bank / paper set from colleagues who can view it (teaching a covered section, the HOD, the Exam
// Cell): GET lists them (anyone who can read it), POST { text, questionId?, questionLabel? } adds one (not the owner),
// PATCH { suggestionId, resolved } - the owner marks one done (or reopens it). The owner is told of each new one.
// The Exam Cell may add `reopen: true` on an APPROVED bank / paper set ("needs changes"): it goes back to the owner
// (approval RETURNED + `reopened`, editable past the deadline) and must be submitted and approved by the HOD again.
// Refused once its paper is printed (a finalized Exam Cell choice) - the printed copy is the record.

const REOPENERS = ["EXAM_CELL", "SUPER_ADMIN"];
async function printedChoice(db: FirebaseFirestore.Firestore, collegeId: string, bankId: string): Promise<boolean> {
  const snap = await midBankRefs(db, collegeId).college.collection("midPaperChoices").where("bankId", "==", bankId).get();
  return snap.docs.some((d) => !!d.get("final"));
}

type Params = { params: Promise<{ id: string }> };
const col = (db: FirebaseFirestore.Firestore, c: string, id: string) => midBankRefs(db, c).banks.doc(id).collection("suggestions");

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_BANK_READ_ROLES);
    const { id } = await params;
    const db = getAdminDb();
    const access = await bankAccess(db, session, id);
    if (!access?.canRead) return NextResponse.json({ error: "Question bank not found. It may have been deleted." }, { status: 404 });
    const snap = await col(db, session.collegeId, id).get();
    const suggestions = snap.docs.map((d) => ({ ...(d.data() as Omit<MidBankSuggestion, "id">), id: d.id })).sort((a, b) => b.at.localeCompare(a.at));
    const canReopen = REOPENERS.includes(session.role) && access.bank.approval === "APPROVED" && !access.bank.withdrawn && !(await printedChoice(db, session.collegeId, id));
    return NextResponse.json({ suggestions, canSuggest: !access.isOwner, canResolve: access.isOwner, canReopen });
  } catch (err) {
    return guardError(err, "[college/mid-question-banks/[id]/suggestions GET]");
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_BANK_READ_ROLES);
    const { id } = await params;
    const body = (await readJsonBody(request)) as { text?: unknown; questionId?: unknown; questionLabel?: unknown; reopen?: unknown };
    const reopen = body.reopen === true;
    const text = String(body.text ?? "").trim().slice(0, 1000);
    if (!text) return NextResponse.json({ error: "Write the suggestion" }, { status: 400 });
    const db = getAdminDb();
    const access = await bankAccess(db, session, id);
    if (!access?.canRead) return NextResponse.json({ error: "Question bank not found. It may have been deleted." }, { status: 404 });
    if (access.isOwner) return NextResponse.json({ error: "This is your own - edit it instead" }, { status: 409 });
    const byName = (await actorName(db, session.collegeId, session.uid)) || session.email;
    const s: Omit<MidBankSuggestion, "id"> = {
      text, byUid: session.uid, byName, at: new Date().toISOString(), resolved: null,
      ...(typeof body.questionId === "string" && body.questionId ? { questionId: body.questionId.slice(0, 120), questionLabel: String(body.questionLabel ?? "").slice(0, 80) } : {}),
    };
    const b = access.bank;
    let ref: FirebaseFirestore.DocumentReference;
    if (reopen) {
      if (!REOPENERS.includes(session.role)) return NextResponse.json({ error: "Only the Exam Cell can send an approved paper back for changes" }, { status: 403 });
      if (await printedChoice(db, session.collegeId, id)) return NextResponse.json({ error: "This paper is already printed for the exam - it can't be reopened" }, { status: 409 });
      const bankRef = midBankRefs(db, session.collegeId).banks.doc(id);
      ref = col(db, session.collegeId, id).doc();
      const at = s.at;
      const out = await db.runTransaction(async (tx) => {
        const cur = (await tx.get(bankRef)).data() as MidQuestionBank | undefined;
        if (!cur) return "missing";
        if (cur.withdrawn) return "withdrawn";
        if (cur.approval !== "APPROVED") return "not-approved";
        const entry: MidBankApprovalEntry = { at, byUid: session.uid, byName, action: "REOPENED", remarks: text, department: "Exam Cell" };
        tx.set(ref, { ...s, reopen: true });
        tx.update(bankRef, {
          approval: "RETURNED", approvalHistory: [...(cur.approvalHistory ?? []), entry],
          reopened: { at, byUid: session.uid, byName, suggestionId: ref.id, text }, updatedAt: FieldValue.serverTimestamp(),
        });
        return "ok";
      });
      if (out !== "ok") return NextResponse.json({ error: out === "not-approved" ? "Only an approved paper can be reopened - it isn't approved now" : out === "withdrawn" ? "This setter was removed - it can't be reopened" : "Question bank not found" }, { status: out === "missing" ? 404 : 409 });
      await writeAuditLogSafe(db, session.collegeId, {
        action: "MID_BANK_REOPEN", performedBy: session.uid, performedByName: byName, targetId: id,
        details: { reopenedByExamCell: true, subject: b.subjectName, branch: b.branch, owner: b.ownerName, text },
      });
    } else {
      ref = await col(db, session.collegeId, id).add(s);
    }
    if (reopen && b.ownerUid) {
      await notify(db, session.collegeId, b.ownerUid, "MID_BANK_REVIEWED", `Changes asked by the Exam Cell - ${b.subjectName}`,
        `${b.subjectName} (${b.branch}) is open for changes again: ${text.slice(0, 140)}. Edit it, then submit it to your HOD.`, `/panel/mid-bank/${encodeURIComponent(id)}`);
    } else if (b.ownerUid) {
      await notify(db, session.collegeId, b.ownerUid, "MID_BANK_SUGGESTION", `Suggestion from ${byName}`,
        `${b.subjectName} (${b.branch})${s.questionLabel ? ` - ${s.questionLabel}` : ""}: ${text.slice(0, 140)}`, `/panel/mid-bank/${encodeURIComponent(id)}/review`);
    }
    return NextResponse.json({ suggestion: { ...s, id: ref.id, ...(reopen ? { reopen: true } : {}) }, reopened: reopen }, { status: 201 });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-question-banks/[id]/suggestions POST]");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_BANK_READ_ROLES);
    const { id } = await params;
    const body = (await readJsonBody(request)) as { suggestionId?: unknown; resolved?: unknown };
    const db = getAdminDb();
    const access = await bankAccess(db, session, id);
    if (!access?.isOwner) return NextResponse.json({ error: "Only the faculty preparing it marks suggestions done" }, { status: 403 });
    const ref = col(db, session.collegeId, id).doc(String(body.suggestionId ?? ""));
    if (!(await ref.get()).exists) return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
    const byName = (await actorName(db, session.collegeId, session.uid)) || session.email;
    await ref.update({ resolved: body.resolved === false ? null : { at: new Date().toISOString(), byName } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-question-banks/[id]/suggestions PATCH]");
  }
}
