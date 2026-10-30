import type { Firestore } from "firebase-admin/firestore";
import type { DutyRef, DutySlot, InvigilationRules, InvigilationSchedule } from "@/types/invigilation";
import { ACTIVE_DUTY_STATUSES } from "@/types/invigilation";
import { evaluate, rankCandidates, displayAvailability, workload, remainingFor, type Evaluation } from "./eligibility";
import { sessionOrder } from "./slots";
import { parseSession, sessionKey } from "./rules";
import { dayClasses, dayLeave, facultyPool, factsFor, scheduleLocks, scheduleSlots, subjectTeachers, writingOn, type PoolFaculty } from "./server";

// Everything needed to judge people for one slot (or a whole session, for the
// Free Faculty view): the slot, the faculty pool, their day, the subjects
// they teach and the duties they hold. Read once per request.

export type Schedule = InvigilationSchedule & { rules: InvigilationRules };

export interface Candidate {
  facultyId: string;
  employeeId: string;
  name: string;
  department: string;
  designation: string;
  roles: string[];
  availability: ReturnType<typeof displayAvailability>;
  evaluation: Evaluation;
  duties: DutyRef[];
  workload: ReturnType<typeof workload>;
  remaining: number | null;
  rooms: { room: string; date: string }[];
}

/** A whole session as a slot (no room, no subjects) - for "who is free then". */
function sessionSlot(session: string, slots: DutySlot[]): DutySlot {
  const { date, from, to } = parseSession(session);
  const any = slots.find((s) => s.session === session);
  return { key: `${session}|FREE`, session: sessionKey(date, from, to), date, from, to, category: any?.category ?? "SQUAD", students: 0, required: Number.MAX_SAFE_INTEGER, subjects: [], groups: any?.groups ?? [], courseYears: any?.courseYears ?? [] };
}

export async function slotContext(db: Firestore, c: string, schedule: Schedule, which: { slotKey?: string; session?: string }) {
  const { slots } = await scheduleSlots(db, c, schedule);
  const slot = which.slotKey ? slots.find((s) => s.key === which.slotKey) : which.session ? sessionSlot(which.session, slots) : undefined;
  if (!slot) return null;
  const suspended = schedule.rules.suspendExamYearClasses ? writingOn(slots, slot.date) : [];
  const [pool, day, leave, teachers, locks] = await Promise.all([
    facultyPool(db, c),
    dayClasses(db, c, slot.date, suspended),
    dayLeave(db, c, slot.date),
    subjectTeachers(db, c, slot.subjects.map((s) => s.id)),
    scheduleLocks(db, c, schedule.id),
  ]);
  return { slots, slot, sessions: sessionOrder(slots), pool, day: { ...day, leave }, teachers, locks };
}

export type SlotContext = NonNullable<Awaited<ReturnType<typeof slotContext>>>;

export function filledOf(ctx: SlotContext): number {
  let n = 0;
  for (const list of ctx.locks.values()) n += list.filter((d) => d.slotKey === ctx.slot.key && ACTIVE_DUTY_STATUSES.includes(d.status)).length;
  return n;
}

/** Every pool member judged for the slot, fairest first. */
export function candidates(ctx: SlotContext, schedule: Schedule, opts: { replacing?: string } = {}): Candidate[] {
  const filled = filledOf(ctx);
  const list = ctx.pool.map((f: PoolFaculty) => {
    const duties = ctx.locks.get(f.id) ?? [];
    const evaluation = evaluate(ctx.slot, factsFor(f, ctx.day, ctx.teachers, duties), schedule.rules, { sessions: ctx.sessions, filled, replacing: opts.replacing });
    const w = workload(duties, schedule.rules.countCategories, ctx.slot.date);
    const roomOf = new Map(ctx.slots.filter((s) => s.roomId).map((s) => [s.key, s.room ?? ""]));
    return {
      facultyId: f.id, employeeId: f.employeeId, name: f.name, department: f.department, designation: f.designation, roles: f.roles,
      availability: displayAvailability(evaluation), evaluation, duties, workload: w, remaining: remainingFor(f.designation, w.total, schedule.rules),
      rooms: duties.filter((d) => d.roomId && ACTIVE_DUTY_STATUSES.includes(d.status)).map((d) => ({ room: roomOf.get(d.slotKey) ?? d.roomId ?? "", date: d.date })),
    };
  });
  return rankCandidates(list, ctx.slot, schedule.rules);
}
