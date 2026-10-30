export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { midSources } from "@/lib/exams/seatingPairedServer";
import { cleanRules } from "@/lib/invigilation/rules";
import { sessionOrder } from "@/lib/invigilation/slots";
import { actorName, dutiesCol, facultyPool, INVIGILATION_READ_ROLES, invigilationError, loadSchedule, locksCol, scheduleLocks, scheduleSlots, schedulesCol } from "@/lib/invigilation/server";
import { ACTIVE_DUTY_STATUSES, type InvigilationDuty, type InvigilationSchedule } from "@/types/invigilation";

// One invigilation schedule: GET = the overview every Exam Cell page works
// from (slots with how many are filled, every duty, the faculty pool with
// their duty refs); PATCH = name / Mid timetables / rules / status; DELETE =
// only while nothing was published.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const session = await requireCollegeMember(...INVIGILATION_READ_ROLES);
    const { id } = await params;
    const db = getAdminDb();
    const schedule = await loadSchedule(db, session.collegeId, id);
    if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    const [{ slots, seatingPlans }, dutiesSnap, pool, locks] = await Promise.all([
      scheduleSlots(db, session.collegeId, schedule),
      dutiesCol(db, session.collegeId).where("scheduleId", "==", id).get(),
      facultyPool(db, session.collegeId),
      scheduleLocks(db, session.collegeId, id),
    ]);
    const duties = dutiesSnap.docs.map((d) => ({ ...(d.data() as InvigilationDuty), id: d.id }));
    const filled = new Map<string, number>();
    for (const d of duties) if (ACTIVE_DUTY_STATUSES.includes(d.status)) filled.set(d.slotKey, (filled.get(d.slotKey) ?? 0) + 1);
    // Faculty who once held a duty but left the pool (status changed) still show in the reports.
    const known = new Set(pool.map((f) => f.id));
    const departed = [...new Map(duties.filter((d) => !known.has(d.facultyId)).map((d) => [d.facultyId, { id: d.facultyId, employeeId: d.employeeId, name: d.facultyName, department: d.department, designation: d.designation, roles: [] as string[], inactive: true }])).values()];
    return NextResponse.json({
      schedule,
      slots: slots.map((s) => ({ ...s, filled: filled.get(s.key) ?? 0 })),
      sessions: sessionOrder(slots),
      seatingPlans,
      duties,
      faculty: [...pool, ...departed].map((f) => ({ ...f, duties: locks.get(f.id) ?? [] })),
      canOverride: schedule.rules.approverUids.includes(session.uid),
    });
  } catch (err) {
    return invigilationError(err, "[invigilation/schedules/[id] GET]");
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const { id } = await params;
    const db = getAdminDb();
    const body = (await readJsonBody(request)) as { name?: string; midPlanIds?: string[]; rules?: unknown; status?: string };
    const schedule = await loadSchedule(db, session.collegeId, id);
    if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    const update: Partial<InvigilationSchedule> & { updatedAt: Date } = { updatedAt: new Date() };
    if (body.name !== undefined) {
      if (!String(body.name).trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
      update.name = String(body.name).trim();
    }
    if (body.midPlanIds !== undefined) {
      const sources = await midSources(db, session.collegeId);
      const ids = [...new Set(body.midPlanIds.map(String))].filter((x) => sources.some((s) => s.id === x));
      if (!ids.length) return NextResponse.json({ error: "Pick at least one Mid timetable" }, { status: 400 });
      update.midPlanIds = ids;
      update.days = [...new Set(sources.filter((s) => ids.includes(s.id)).flatMap((s) => s.days))].sort();
    }
    if (body.rules !== undefined) {
      const { rules, errors } = cleanRules(body.rules);
      if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
      update.rules = rules;
    }
    if (body.status !== undefined) {
      if (body.status !== "ACTIVE" && body.status !== "CLOSED") return NextResponse.json({ error: "Unknown status" }, { status: 400 });
      update.status = body.status;
    }
    await schedulesCol(db, session.collegeId).doc(id).update(update);
    if (update.rules) {
      await writeAuditLogSafe(db, session.collegeId, {
        action: "INVIGILATION_RULES_CHANGED", performedBy: session.uid, performedByName: await actorName(db, session.collegeId, session.uid, session.email || "Exam Cell"),
        targetId: id, details: { schedule: schedule.name },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return invigilationError(err, "[invigilation/schedules/[id] PATCH]");
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const { id } = await params;
    const db = getAdminDb();
    const [duties, locks, slotLocks] = await Promise.all([
      dutiesCol(db, session.collegeId).where("scheduleId", "==", id).get(),
      locksCol(db, session.collegeId).where("scheduleId", "==", id).get(),
      db.collection("colleges").doc(session.collegeId).collection("invigilationSlotLocks").where("scheduleId", "==", id).get(),
    ]);
    if (duties.docs.some((d) => (d.data() as InvigilationDuty).status !== "DRAFT" && (d.data() as InvigilationDuty).status !== "CANCELLED")) {
      return NextResponse.json({ error: "Duties of this schedule were published - close it instead of deleting" }, { status: 409 });
    }
    const w = new ChunkedBatch(db);
    for (const d of [...duties.docs, ...locks.docs, ...slotLocks.docs]) w.delete(d.ref);
    await w.commit();
    await schedulesCol(db, session.collegeId).doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return invigilationError(err, "[invigilation/schedules/[id] DELETE]");
  }
}
