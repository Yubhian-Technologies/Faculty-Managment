import type { DutySlot, InvigilationRules } from "@/types/invigilation";
import { invigilatorsFor, relieversFor, sessionKey } from "./rules";

// Where duties are needed (pure). Every exam of the schedule's Mid timetables
// is a session (date + time). A room of a paired seating plan is in a session
// when a branch seated in it writes then - it needs invigilators for the
// students of the branches writing; each session needs relievers (by its
// rooms) and a special squad.

export interface ExamOfGroup {
  date: string;
  from: string;
  to: string;
  subjects: { id: string; code: string; name: string }[];
  courseIds: string[];
  year: number;
  semester: number;
}

export interface SeatedRoom {
  roomId: string;
  name: string;
  block: string;
  floor: number;
  /** Students in the room per group (branch + year, as the seating plan names it). */
  groups: Record<string, number>;
}

const roomLabel = (r: Pick<SeatedRoom, "block" | "floor" | "name">) => `Block ${r.block}, Floor ${r.floor}, Room ${r.name}`;

export function buildSlots(groups: Map<string, ExamOfGroup[]>, rooms: SeatedRoom[], r: InvigilationRules): DutySlot[] {
  type Acc = Omit<DutySlot, "required" | "category" | "key">;
  const sessions = new Map<string, Acc>();
  const roomSlots = new Map<string, Acc & { roomId: string }>();
  const addTo = (acc: Acc, group: string, e: ExamOfGroup, students: number) => {
    acc.students += students;
    if (!acc.groups.includes(group)) acc.groups.push(group);
    for (const s of e.subjects) if (!acc.subjects.some((x) => x.id === s.id)) acc.subjects.push(s);
    if (!acc.courseYears.some((c) => c.year === e.year && c.semester === e.semester && c.courseIds.join() === e.courseIds.join())) {
      acc.courseYears.push({ courseIds: e.courseIds, year: e.year, semester: e.semester });
    }
  };
  const blank = (e: ExamOfGroup): Acc => ({ session: sessionKey(e.date, e.from, e.to), date: e.date, from: e.from, to: e.to, students: 0, subjects: [], groups: [], courseYears: [] });

  for (const [group, exams] of groups) {
    for (const e of exams) {
      const k = sessionKey(e.date, e.from, e.to);
      const acc = sessions.get(k) ?? blank(e);
      addTo(acc, group, e, 0);
      sessions.set(k, acc);
    }
  }
  for (const room of rooms) {
    for (const [group, count] of Object.entries(room.groups)) {
      for (const e of groups.get(group) ?? []) {
        const k = `${sessionKey(e.date, e.from, e.to)}|${room.roomId}`;
        const acc = roomSlots.get(k) ?? { ...blank(e), roomId: room.roomId, room: roomLabel(room), block: room.block };
        addTo(acc, group, e, count);
        roomSlots.set(k, acc);
        sessions.get(acc.session)!.students += count;
      }
    }
  }

  const out: DutySlot[] = [];
  if (r.categories.INVIGILATOR) {
    for (const [key, acc] of roomSlots) out.push({ ...acc, key, category: "INVIGILATOR", required: invigilatorsFor(acc.students, r) });
  }
  for (const [key, acc] of sessions) {
    const roomsInUse = [...roomSlots.values()].filter((x) => x.session === key).length;
    if (r.categories.RELIEVER) out.push({ ...acc, key: `${key}|RELIEVER`, category: "RELIEVER", required: relieversFor(roomsInUse, r) });
    if (r.categories.SQUAD) out.push({ ...acc, key: `${key}|SQUAD`, category: "SQUAD", required: r.squadPerSession });
  }
  const order = { INVIGILATOR: 0, RELIEVER: 1, SQUAD: 2 } as const;
  return out.sort((a, b) => a.session.localeCompare(b.session) || order[a.category] - order[b.category] || (a.room ?? "").localeCompare(b.room ?? "", undefined, { numeric: true }));
}

/** The schedule's sessions in time order. */
export function sessionOrder(slots: Pick<DutySlot, "session">[]): string[] {
  return [...new Set(slots.map((s) => s.session))].sort();
}
