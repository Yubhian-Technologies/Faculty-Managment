export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { assignDuty, DutyRefused } from "@/lib/invigilation/assign";
import { candidates, filledOf, slotContext } from "@/lib/invigilation/context";
import { actorName, factsFor, invigilationError, loadSchedule } from "@/lib/invigilation/server";

// Put people on one duty (Exam Cell). { slotKey, facultyIds, reason? } - each
// person is saved in their own transaction (re-checked there), so one refusal
// never stops the others; or { slotKey, auto: true } fills the open places with
// the fairest AVAILABLE people (no overrides). Returns each person's outcome.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const { id } = await params;
    const body = (await readJsonBody(request)) as { slotKey?: string; facultyIds?: string[]; reason?: string; auto?: boolean };
    const db = getAdminDb();
    const schedule = await loadSchedule(db, session.collegeId, id);
    if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    if (schedule.status !== "ACTIVE") return NextResponse.json({ error: "This schedule is closed" }, { status: 409 });
    const ctx = await slotContext(db, session.collegeId, schedule, { slotKey: String(body.slotKey ?? "") });
    if (!ctx) return NextResponse.json({ error: "That duty is no longer in the schedule - reload" }, { status: 404 });

    let ids = [...new Set((body.facultyIds ?? []).map(String))];
    if (body.auto) {
      const open = Math.max(0, ctx.slot.required - filledOf(ctx));
      ids = candidates(ctx, schedule).filter((c) => c.availability === "AVAILABLE").slice(0, open).map((c) => c.facultyId);
      if (!ids.length) return NextResponse.json({ error: open ? "Nobody is available without an override - pick people yourself" : "This duty is already filled" }, { status: 409 });
    }
    if (!ids.length) return NextResponse.json({ error: "Pick at least one faculty member" }, { status: 400 });
    if (ids.length > 20) return NextResponse.json({ error: "At most 20 people at a time" }, { status: 400 });

    const actor = { uid: session.uid, name: await actorName(db, session.collegeId, session.uid, session.email || "Exam Cell") };
    const results: { facultyId: string; ok: boolean; dutyId?: string; error?: string }[] = [];
    for (const fid of ids) {
      const f = ctx.pool.find((x) => x.id === fid);
      if (!f) { results.push({ facultyId: fid, ok: false, error: "Not an available faculty member" }); continue; }
      try {
        const d = await assignDuty(db, session.collegeId, {
          schedule, slot: ctx.slot, faculty: f, facts: factsFor(f, ctx.day, ctx.teachers, []), sessions: ctx.sessions, actor,
          reason: body.auto ? undefined : body.reason,
        });
        results.push({ facultyId: fid, ok: true, dutyId: d.id });
      } catch (e) {
        if (e instanceof DutyRefused) results.push({ facultyId: fid, ok: false, error: e.message });
        else throw e;
      }
    }
    const saved = results.filter((r) => r.ok).length;
    return NextResponse.json({ saved, results }, { status: saved ? 201 : 409 });
  } catch (err) {
    return invigilationError(err, "[invigilation/duties POST]");
  }
}
