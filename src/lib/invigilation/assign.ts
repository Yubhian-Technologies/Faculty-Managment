import type { Firestore } from "firebase-admin/firestore";
import { notify } from "@/lib/notify";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { ACTIVE_DUTY_STATUSES, DUTY_CATEGORY_LABELS, type DutyOverride, type DutyRef, type DutySlot, type DutyStatus, type FacultyDutyLock, type InvigilationDuty, type InvigilationRules, type InvigilationSchedule } from "@/types/invigilation";
import { evaluate, type CandidateFacts, type Issue } from "./eligibility";
import { dutiesCol, lockId, locksCol, refOf } from "./server";
import type { PoolFaculty } from "./server";
import { dayLabel, timeLabel } from "@/lib/midTimetable/rules";
import { istDateKey, istTimeHHMM } from "@/lib/attendance/istTime";

// Writing duties - every change in a transaction on the holder's lock doc
// (invigilationFacultyLocks/{schedule}__{faculty}: every duty they hold in the
// schedule). Two Exam Cell users assigning the same person at once both read
// that doc, so one of them retries and sees the other's duty: no double
// booking, no limit slipping past. The slot's own lock doc does the same for
// the number of people on a duty.

export class DutyRefused extends Error {
  constructor(public issues: Issue[], message?: string) { super(message ?? issues.map((i) => i.message).join("; ")); }
}

export interface Actor { uid: string; name: string }

const slotLockId = (scheduleId: string, slotKey: string) => `${scheduleId}__${slotKey.replace(/\//g, "_")}`;
const slotLocks = (db: Firestore, c: string) => db.collection("colleges").doc(c).collection("invigilationSlotLocks");
const nowIso = () => new Date().toISOString();

/** A duty is done only once its exam session has ended (IST). */
export function sessionEnded(d: Pick<InvigilationDuty, "date" | "to">, now: Date = new Date()): boolean {
  const today = istDateKey(now);
  return d.date < today || (d.date === today && istTimeHHMM(now) >= d.to);
}

/** Which warning issues the caller may override (named approvers only, with a reason). */
function settle(issues: Issue[], rules: InvigilationRules, actor: Actor, reason: string | undefined): DutyOverride[] {
  const hard = issues.filter((i) => i.level === "HARD");
  if (hard.length) throw new DutyRefused(hard);
  const warn = issues.filter((i) => i.level === "WARN");
  if (!warn.length) return [];
  if (!reason?.trim()) throw new DutyRefused(warn, `Needs an override with a reason: ${warn.map((w) => w.message).join("; ")}`);
  if (!rules.approverUids.includes(actor.uid)) throw new DutyRefused(warn, `Only the Exam Cell users named as approvers may override: ${warn.map((w) => w.message).join("; ")}`);
  return warn.map((w) => ({ rule: w.rule, message: w.message, reason: reason.trim(), byUid: actor.uid, byName: actor.name, at: nowIso() }));
}

const sessionText = (d: Pick<InvigilationDuty, "date" | "from" | "to" | "category" | "room">) =>
  `${DUTY_CATEGORY_LABELS[d.category]} · ${dayLabel(d.date)} · ${timeLabel(d.from)} - ${timeLabel(d.to)}${d.room ? ` · ${d.room}` : ""}`;

export async function notifyDuty(db: Firestore, c: string, d: Pick<InvigilationDuty, "facultyUid" | "date" | "from" | "to" | "category" | "room">, title: string) {
  if (d.facultyUid) await notify(db, c, d.facultyUid, "INVIGILATION_DUTY", title, sessionText(d), "/panel/invigilation");
}

/**
 * Puts one person on a duty. `facts` are read outside the transaction (their
 * timetable / leave / subjects that day); the duties they hold are re-read
 * inside it. Throws DutyRefused with the reasons.
 */
export async function assignDuty(db: Firestore, c: string, args: {
  schedule: InvigilationSchedule & { rules: InvigilationRules };
  slot: DutySlot;
  faculty: PoolFaculty;
  facts: CandidateFacts;
  sessions: string[];
  actor: Actor;
  reason?: string;
  replacing?: InvigilationDuty;
}): Promise<InvigilationDuty> {
  const { schedule, slot, faculty, actor } = args;
  const published = schedule.publishedSessions.includes(slot.session);
  const dutyRef = dutiesCol(db, c).doc();
  const myLock = locksCol(db, c).doc(lockId(schedule.id, faculty.id));
  const slotLock = slotLocks(db, c).doc(slotLockId(schedule.id, slot.key));
  const oldLock = args.replacing ? locksCol(db, c).doc(lockId(schedule.id, args.replacing.facultyId)) : null;

  const duty = await db.runTransaction(async (tx) => {
    const [lockSnap, slotSnap, oldSnap, oldLockSnap] = await Promise.all([
      tx.get(myLock), tx.get(slotLock),
      args.replacing ? tx.get(dutiesCol(db, c).doc(args.replacing.id)) : Promise.resolve(null),
      oldLock && oldLock.path !== myLock.path ? tx.get(oldLock) : Promise.resolve(null),
    ]);
    if (args.replacing && (!oldSnap?.exists || !ACTIVE_DUTY_STATUSES.includes((oldSnap.data() as InvigilationDuty).status))) {
      throw new DutyRefused([], "That duty changed meanwhile - reload");
    }
    const held = ((lockSnap.data() as FacultyDutyLock | undefined)?.duties ?? []);
    const slotIds = ((slotSnap.data() as { dutyIds?: string[] } | undefined)?.dutyIds ?? []);
    const filled = slotIds.length - (args.replacing && slotIds.includes(args.replacing.id) ? 1 : 0);
    const e = evaluate(slot, { ...args.facts, duties: held }, schedule.rules, { sessions: args.sessions, filled, replacing: args.replacing?.id });
    const overrides = settle(e.issues, schedule.rules, actor, args.reason);

    const status: DutyStatus = published || (args.replacing && args.replacing.status !== "DRAFT") ? "PUBLISHED" : "DRAFT";
    const d: InvigilationDuty = {
      id: dutyRef.id, collegeId: c, scheduleId: schedule.id, slotKey: slot.key, session: slot.session, date: slot.date, from: slot.from, to: slot.to,
      category: slot.category, ...(slot.roomId ? { roomId: slot.roomId, room: slot.room ?? "", block: slot.block ?? "" } : {}),
      facultyId: faculty.id, ...(faculty.userUid ? { facultyUid: faculty.userUid } : {}), employeeId: faculty.employeeId, facultyName: faculty.name,
      department: faculty.department, designation: faculty.designation, status,
      ...(status === "PUBLISHED" ? { publishedAt: nowIso() } : {}),
      ...(args.replacing ? { replaces: args.replacing.id } : {}),
      overrides,
      history: [{ at: nowIso(), byUid: actor.uid, byName: actor.name, action: args.replacing ? "REASSIGNED_IN" : "ASSIGNED", ...(args.replacing ? { note: `from ${args.replacing.facultyName}` } : {}) }],
      createdBy: actor.uid, createdByName: actor.name, createdAt: new Date(), updatedAt: new Date(),
    };
    tx.set(dutyRef, d);
    let mine = [...held, refOf(d)];
    let ids = [...slotIds, d.id];
    if (args.replacing) {
      const r = args.replacing;
      tx.update(dutiesCol(db, c).doc(r.id), {
        status: "REASSIGNED", replacedBy: d.id, updatedAt: new Date(),
        history: [...(r.history ?? []), { at: nowIso(), byUid: actor.uid, byName: actor.name, action: "REASSIGNED_OUT", note: `to ${faculty.name}${args.reason ? ` - ${args.reason}` : ""}` }],
      });
      ids = ids.filter((x) => x !== r.id);
      const mark = (list: DutyRef[]) => list.map((x) => (x.dutyId === r.id ? { ...x, status: "REASSIGNED" as const } : x));
      if (r.facultyId === faculty.id) mine = mark(mine);
      else if (oldLock) tx.set(oldLock, { scheduleId: schedule.id, facultyId: r.facultyId, duties: mark(((oldLockSnap?.data() as FacultyDutyLock | undefined)?.duties ?? [])), updatedAt: new Date() });
    }
    tx.set(myLock, { scheduleId: schedule.id, facultyId: faculty.id, duties: mine, updatedAt: new Date() });
    tx.set(slotLock, { scheduleId: schedule.id, slotKey: slot.key, dutyIds: ids, updatedAt: new Date() });
    return d;
  });

  if (duty.overrides.length) {
    await writeAuditLogSafe(db, c, {
      action: "INVIGILATION_OVERRIDE", performedBy: actor.uid, performedByName: actor.name, targetId: duty.id,
      details: { scheduleId: schedule.id, faculty: duty.facultyName, duty: sessionText(duty), overrides: duty.overrides.map((o) => o.message), reason: duty.overrides[0].reason },
    });
  }
  if (args.replacing) {
    await writeAuditLogSafe(db, c, {
      action: "INVIGILATION_REASSIGNED", performedBy: actor.uid, performedByName: actor.name, targetId: args.replacing.id,
      details: { scheduleId: schedule.id, from: args.replacing.facultyName, to: duty.facultyName, duty: sessionText(duty) },
    });
  }
  if (duty.status === "PUBLISHED") {
    await notifyDuty(db, c, duty, "Exam duty assigned");
    if (args.replacing && args.replacing.status !== "DRAFT" && args.replacing.facultyId !== duty.facultyId) await notifyDuty(db, c, args.replacing, "Exam duty withdrawn - given to another faculty member");
  }
  return duty;
}

/** Status changes of one duty: cancel (Exam Cell), complete (Exam Cell), acknowledge (its holder). */
export async function changeDutyStatus(db: Firestore, c: string, dutyId: string, action: "cancel" | "complete" | "acknowledge", actor: Actor, note?: string): Promise<InvigilationDuty> {
  const ref = dutiesCol(db, c).doc(dutyId);
  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new DutyRefused([], "Duty not found");
    const d = { ...(snap.data() as InvigilationDuty), id: snap.id };
    const allowed: Record<typeof action, DutyStatus[]> = {
      cancel: ["DRAFT", "PUBLISHED", "ACKNOWLEDGED"],
      complete: ["PUBLISHED", "ACKNOWLEDGED"],
      acknowledge: ["PUBLISHED"],
    };
    if (!allowed[action].includes(d.status)) throw new DutyRefused([], `A ${d.status.toLowerCase()} duty can't be ${action === "acknowledge" ? "acknowledged" : action === "cancel" ? "cancelled" : "completed"}`);
    if (action === "complete" && !sessionEnded(d)) throw new DutyRefused([], `This exam ends ${dayLabel(d.date)} ${timeLabel(d.to)} - mark it done after that`);
    const status: DutyStatus = action === "cancel" ? "CANCELLED" : action === "complete" ? "COMPLETED" : "ACKNOWLEDGED";
    const lockRef = locksCol(db, c).doc(lockId(d.scheduleId, d.facultyId));
    const slotRef = slotLocks(db, c).doc(slotLockId(d.scheduleId, d.slotKey));
    const [lock, slot] = await Promise.all([tx.get(lockRef), tx.get(slotRef)]);
    const history = [...(d.history ?? []), { at: nowIso(), byUid: actor.uid, byName: actor.name, action: status, ...(note ? { note } : {}) }];
    tx.update(ref, { status, history, updatedAt: new Date() });
    tx.set(lockRef, { scheduleId: d.scheduleId, facultyId: d.facultyId, duties: ((lock.data() as FacultyDutyLock | undefined)?.duties ?? []).map((x) => (x.dutyId === d.id ? { ...x, status } : x)), updatedAt: new Date() });
    if (status === "CANCELLED") tx.set(slotRef, { scheduleId: d.scheduleId, slotKey: d.slotKey, dutyIds: ((slot.data() as { dutyIds?: string[] } | undefined)?.dutyIds ?? []).filter((x) => x !== d.id), updatedAt: new Date() });
    return { ...d, status, history, wasPublished: d.status !== "DRAFT" };
  });
  if (action === "cancel" && out.wasPublished) await notifyDuty(db, c, out, "Exam duty cancelled");
  if (action === "cancel") {
    await writeAuditLogSafe(db, c, { action: "INVIGILATION_CANCELLED", performedBy: actor.uid, performedByName: actor.name, targetId: out.id, details: { faculty: out.facultyName, duty: sessionText(out), ...(note ? { note } : {}) } });
  }
  return out;
}

export type { DutyRef };
