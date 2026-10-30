import type { ExamSeatingPlan } from "@/types/examSeating";

// Seating x exam timings (pure). A paired plan seats one session's branches, but
// a branch may also write a second exam at another time - its students then sit
// in the same seats. So a room is busy, on each exam day, at the times of every
// exam of every branch seated in it. Two plans that use one room at overlapping
// times on the same day clash.

export interface GroupExam { date: string; from: string; to: string; subjects: string[] }
export interface RoomUse { roomId: string; room: string; group: string; date: string; from: string; to: string; subjects: string[] }

/** When each room of a plan is in use: the exams of every group seated in it. */
export function roomUses(plan: Pick<ExamSeatingPlan, "rooms">, examsOf: (group: string) => GroupExam[]): RoomUse[] {
  const out: RoomUse[] = [];
  for (const r of plan.rooms) {
    for (const group of [...new Set(r.students.map((s) => s.group).filter((g): g is string => Boolean(g)))]) {
      for (const e of examsOf(group)) out.push({ roomId: r.roomId, room: r.name, group, ...e });
    }
  }
  return out;
}

export interface RoomClash { room: string; date: string; mine: RoomUse; theirs: RoomUse; otherPlan: string }

/** Rooms this plan shares with another plan at overlapping times on the same day. */
export function roomClashes(mine: RoomUse[], others: { name: string; uses: RoomUse[] }[]): RoomClash[] {
  const out: RoomClash[] = [];
  const seen = new Set<string>();
  for (const o of others) for (const a of mine) for (const b of o.uses) {
    if (a.roomId !== b.roomId || a.date !== b.date || !(a.from < b.to && b.from < a.to)) continue;
    const k = `${o.name}|${a.roomId}|${a.date}|${a.from}|${b.from}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ room: a.room, date: a.date, mine: a, theirs: b, otherPlan: o.name });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.room.localeCompare(y.room, undefined, { numeric: true }));
}

/** Exams of the plan's branches NOT at the plan's session time (a second exam that day) - they sit in the same seats. */
export function offSessionExams(uses: RoomUse[], examTime?: string): RoomUse[] {
  if (!examTime) return [];
  const seen = new Set<string>();
  return uses.filter((u) => `${u.from}-${u.to}` !== examTime).filter((u) => {
    const k = `${u.group}|${u.date}|${u.from}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
