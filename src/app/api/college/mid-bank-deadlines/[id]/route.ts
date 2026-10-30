export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { istDateKey } from "@/lib/attendance/istTime";
import { deadlineError } from "@/lib/midBank/deadline";
import { midStartDate, notifyTeachers } from "@/lib/midBank/deadlineServer";
import { actorName, guardError, loadDeadline, midBankRefs } from "@/lib/midBank/server";

// Exam Cell: move a question bank deadline (an extension reopens locked banks;
// every change is kept in `extensions`) or delete one no bank has started.

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await readJsonBody(request)) as { deadline?: string };
    const db = getAdminDb();
    const d = await loadDeadline(db, session.collegeId, id);
    if (!d) return NextResponse.json({ error: "Deadline not found" }, { status: 404 });
    const next = String(body.deadline ?? "").trim();
    if (next === d.deadline) return NextResponse.json({ deadline: d });
    const err = deadlineError(next, istDateKey(), await midStartDate(db, session.collegeId, d.courseIds, d.courseName, d.semester, d.midNumber));
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    const name = await actorName(db, session.collegeId, session.uid);
    const extensions = [...(d.extensions ?? []), { from: d.deadline, to: next, byName: name, at: new Date().toISOString() }];
    await midBankRefs(db, session.collegeId).deadlines.doc(id).update({ deadline: next, extensions, updatedAt: new Date() });
    const updated = { ...d, deadline: next, extensions };
    const notified = await notifyTeachers(db, session.collegeId, updated, `Mid ${d.midNumber} question bank deadline changed`);
    return NextResponse.json({ deadline: updated, notified });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-bank-deadlines/[id] PATCH]");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const { id } = await params;
    const refs = midBankRefs(getAdminDb(), session.collegeId);
    const banks = await refs.banks.where("deadlineId", "==", id).limit(1).get();
    if (!banks.empty) return NextResponse.json({ error: "Faculty have already started question banks for this deadline - change the date instead" }, { status: 409 });
    await refs.deadlines.doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return guardError(err, "[college/mid-bank-deadlines/[id] DELETE]");
  }
}
