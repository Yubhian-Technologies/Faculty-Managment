export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { assignDuty, changeDutyStatus, DutyRefused } from "@/lib/invigilation/assign";
import { slotContext } from "@/lib/invigilation/context";
import { actorName, dutiesCol, factsFor, invigilationError, loadSchedule } from "@/lib/invigilation/server";
import { MY_DUTY_ROLES } from "@/lib/invigilation/rolesList";
import type { InvigilationDuty } from "@/types/invigilation";

// One duty. Exam Cell: { action: "cancel" | "complete", note? } or
// { action: "reassign", facultyId, reason? } (the new person is checked like
// any assignment; the old duty is kept as REASSIGNED, linked both ways).
// Its holder: { action: "acknowledge" } on a published duty.

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = (await readJsonBody(request)) as { action?: string; facultyId?: string; reason?: string; note?: string };
    // The holder acknowledges as themselves; every other change is the Exam Cell's.
    const session = body.action === "acknowledge" ? await requireCollegeMember(...MY_DUTY_ROLES) : await requireCollegeMember("EXAM_CELL");
    const { id } = await params;
    const db = getAdminDb();
    const snap = await dutiesCol(db, session.collegeId).doc(id).get();
    if (!snap.exists) return NextResponse.json({ error: "Duty not found" }, { status: 404 });
    const duty = { ...(snap.data() as InvigilationDuty), id: snap.id };
    const actor = { uid: session.uid, name: await actorName(db, session.collegeId, session.uid, session.email || "") };

    try {
      if (body.action === "acknowledge") {
        const mine = await resolveFacultyMemberId(db, session.collegeId, session.uid);
        if (mine !== duty.facultyId) return NextResponse.json({ error: "Not your duty" }, { status: 403 });
        return NextResponse.json({ duty: await changeDutyStatus(db, session.collegeId, id, "acknowledge", actor) });
      }
      if (body.action === "cancel" || body.action === "complete") {
        return NextResponse.json({ duty: await changeDutyStatus(db, session.collegeId, id, body.action, actor, body.note?.trim() || undefined) });
      }
      if (body.action === "reassign") {
        const schedule = await loadSchedule(db, session.collegeId, duty.scheduleId);
        if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
        if (schedule.status !== "ACTIVE") return NextResponse.json({ error: "This schedule is closed" }, { status: 409 });
        const ctx = await slotContext(db, session.collegeId, schedule, { slotKey: duty.slotKey });
        if (!ctx) return NextResponse.json({ error: "That duty is no longer in the schedule" }, { status: 409 });
        const f = ctx.pool.find((x) => x.id === body.facultyId);
        if (!f) return NextResponse.json({ error: "Pick an available faculty member" }, { status: 400 });
        if (f.id === duty.facultyId) return NextResponse.json({ error: "That is who holds it now" }, { status: 400 });
        const d = await assignDuty(db, session.collegeId, {
          schedule, slot: ctx.slot, faculty: f, facts: factsFor(f, ctx.day, ctx.teachers, []), sessions: ctx.sessions, actor, reason: body.reason, replacing: duty,
        });
        return NextResponse.json({ duty: d });
      }
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    } catch (e) {
      if (e instanceof DutyRefused) return NextResponse.json({ error: e.message, issues: e.issues }, { status: 409 });
      throw e;
    }
  } catch (err) {
    return invigilationError(err, "[invigilation/duties/[id] PATCH]");
  }
}
