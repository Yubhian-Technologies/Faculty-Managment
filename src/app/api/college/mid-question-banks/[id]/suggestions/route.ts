export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { notify } from "@/lib/notify";
import { actorName, bankAccess, guardError, MID_BANK_READ_ROLES, midBankRefs } from "@/lib/midBank/server";
import type { MidBankSuggestion } from "@/types";

// Suggestions on a bank / paper set from colleagues who can view it (teaching a covered section, the HOD, the Exam
// Cell): GET lists them (anyone who can read it), POST { text, questionId?, questionLabel? } adds one (not the owner),
// PATCH { suggestionId, resolved } - the owner marks one done (or reopens it). The owner is told of each new one.

type Params = { params: Promise<{ id: string }> };
const col = (db: FirebaseFirestore.Firestore, c: string, id: string) => midBankRefs(db, c).banks.doc(id).collection("suggestions");

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_BANK_READ_ROLES);
    const { id } = await params;
    const db = getAdminDb();
    const access = await bankAccess(db, session, id);
    if (!access?.canRead) return NextResponse.json({ error: "Question bank not found" }, { status: 404 });
    const snap = await col(db, session.collegeId, id).get();
    const suggestions = snap.docs.map((d) => ({ ...(d.data() as Omit<MidBankSuggestion, "id">), id: d.id })).sort((a, b) => b.at.localeCompare(a.at));
    return NextResponse.json({ suggestions, canSuggest: !access.isOwner, canResolve: access.isOwner });
  } catch (err) {
    return guardError(err, "[college/mid-question-banks/[id]/suggestions GET]");
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_BANK_READ_ROLES);
    const { id } = await params;
    const body = (await readJsonBody(request)) as { text?: unknown; questionId?: unknown; questionLabel?: unknown };
    const text = String(body.text ?? "").trim().slice(0, 1000);
    if (!text) return NextResponse.json({ error: "Write the suggestion" }, { status: 400 });
    const db = getAdminDb();
    const access = await bankAccess(db, session, id);
    if (!access?.canRead) return NextResponse.json({ error: "Question bank not found" }, { status: 404 });
    if (access.isOwner) return NextResponse.json({ error: "This is your own - edit it instead" }, { status: 409 });
    const byName = (await actorName(db, session.collegeId, session.uid)) || session.email;
    const s: Omit<MidBankSuggestion, "id"> = {
      text, byUid: session.uid, byName, at: new Date().toISOString(), resolved: null,
      ...(typeof body.questionId === "string" && body.questionId ? { questionId: body.questionId.slice(0, 120), questionLabel: String(body.questionLabel ?? "").slice(0, 80) } : {}),
    };
    const ref = await col(db, session.collegeId, id).add(s);
    const b = access.bank;
    if (b.ownerUid) {
      await notify(db, session.collegeId, b.ownerUid, "MID_BANK_SUGGESTION", `Suggestion from ${byName}`,
        `${b.subjectName} (${b.branch})${s.questionLabel ? ` - ${s.questionLabel}` : ""}: ${text.slice(0, 140)}`, `/panel/mid-bank/${encodeURIComponent(id)}/review`);
    }
    return NextResponse.json({ suggestion: { ...s, id: ref.id } }, { status: 201 });
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
