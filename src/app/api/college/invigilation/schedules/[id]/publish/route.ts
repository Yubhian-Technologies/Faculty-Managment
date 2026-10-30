export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { changeDutyStatus, DutyRefused, notifyDuty } from "@/lib/invigilation/assign";
import { actorName, dutiesCol, invigilationError, loadSchedule, schedulesCol } from "@/lib/invigilation/server";
import type { InvigilationDuty } from "@/types/invigilation";

// Exam-wise publishing (Exam Cell): { sessions, action: "publish" } makes the
// DRAFT duties of those sessions (date + time) PUBLISHED and tells each
// person - faculty learn of a duty only then; later changes in a published
// session notify them as they happen. { action: "complete" } marks those
// sessions' published / acknowledged duties done.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const { id } = await params;
    const body = (await readJsonBody(request)) as { sessions?: string[]; action?: string };
    const db = getAdminDb();
    const schedule = await loadSchedule(db, session.collegeId, id);
    if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    const sessions = [...new Set((body.sessions ?? []).map(String))].filter(Boolean);
    if (!sessions.length) return NextResponse.json({ error: "Pick an exam session" }, { status: 400 });
    const actor = { uid: session.uid, name: await actorName(db, session.collegeId, session.uid, session.email || "Exam Cell") };
    const snap = await dutiesCol(db, session.collegeId).where("scheduleId", "==", id).get();
    const duties = snap.docs.map((d) => ({ ...(d.data() as InvigilationDuty), id: d.id })).filter((d) => sessions.includes(d.session));

    if (body.action === "complete") {
      let done = 0;
      for (const d of duties.filter((x) => x.status === "PUBLISHED" || x.status === "ACKNOWLEDGED")) {
        try { await changeDutyStatus(db, session.collegeId, d.id, "complete", actor); done++; } catch (e) { if (!(e instanceof DutyRefused)) throw e; }
      }
      return NextResponse.json({ completed: done });
    }
    if (body.action !== "publish") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

    const drafts = duties.filter((d) => d.status === "DRAFT");
    const at = new Date().toISOString();
    const batch = db.batch();
    for (const d of drafts) {
      batch.update(dutiesCol(db, session.collegeId).doc(d.id), { status: "PUBLISHED", publishedAt: at, updatedAt: new Date(), history: [...(d.history ?? []), { at, byUid: actor.uid, byName: actor.name, action: "PUBLISHED" }] });
    }
    batch.update(schedulesCol(db, session.collegeId).doc(id), { publishedSessions: [...new Set([...schedule.publishedSessions, ...sessions])], updatedAt: new Date() });
    await batch.commit();
    // Lock docs carry each duty's status for the counts.
    const byFaculty = new Map<string, Set<string>>();
    for (const d of drafts) byFaculty.set(d.facultyId, (byFaculty.get(d.facultyId) ?? new Set()).add(d.id));
    await Promise.all([...byFaculty].map(async ([fid, ids]) => {
      const ref = db.collection("colleges").doc(session.collegeId).collection("invigilationFacultyLocks").doc(`${id}__${fid}`);
      await db.runTransaction(async (tx) => {
        const l = await tx.get(ref);
        const list = ((l.data() as { duties?: { dutyId: string; status: string }[] } | undefined)?.duties ?? []).map((x) => (ids.has(x.dutyId) && x.status === "DRAFT" ? { ...x, status: "PUBLISHED" } : x));
        tx.set(ref, { duties: list, updatedAt: new Date() }, { merge: true });
      });
    }));
    for (const d of drafts) await notifyDuty(db, session.collegeId, d, "Exam duty assigned");
    await writeAuditLogSafe(db, session.collegeId, {
      action: "INVIGILATION_PUBLISHED", performedBy: actor.uid, performedByName: actor.name, targetId: id,
      details: { schedule: schedule.name, sessions, duties: drafts.length },
    });
    return NextResponse.json({ published: drafts.length });
  } catch (err) {
    return invigilationError(err, "[invigilation/publish POST]");
  }
}
