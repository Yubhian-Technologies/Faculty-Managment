import type { SeatingRoomAllocation, SeatingStudent } from "@/types/examSeating";

// Paired seating (pure): each seat position of a bench has its own stream of
// students - e.g. seat A: CSE, seat B: Civil then Mech. Rooms are filled in the
// order given, bench by bench; each bench takes the next student of every seat's
// stream. When a stream runs out its seat stays empty (the others go on one per
// bench), so two students of one group never share a bench. Students the rooms
// can't hold come back as `unplaced`.

export const SEAT_LETTERS = "ABC";

export interface PairedRoom { roomId: string; name: string; block: string; floor: number; benches: number; perBench: number }

export function allocatePaired(rooms: PairedRoom[], streams: SeatingStudent[][]): { rooms: SeatingRoomAllocation[]; unplaced: SeatingStudent[] } {
  const next = streams.map(() => 0);
  const left = (s: number) => next[s] < streams[s].length;
  const out = rooms.map((r): SeatingRoomAllocation => {
    const students: SeatingStudent[] = [];
    const seats = Math.min(r.perBench, streams.length);
    for (let bench = 1; bench <= r.benches; bench++) {
      if (!streams.some((_, s) => s < seats && left(s))) break;
      for (let s = 0; s < seats; s++) {
        if (!left(s)) continue;
        students.push({ ...streams[s][next[s]++], bench, layer: s + 1 });
      }
    }
    return { roomId: r.roomId, name: r.name, block: r.block, floor: r.floor, capacity: r.benches * r.perBench, benches: r.benches, perBench: r.perBench, students };
  });
  return { rooms: out, unplaced: streams.flatMap((list, s) => list.slice(next[s])) };
}

/** A paired room is valid when every seat is a real bench + seat, used once, and no bench holds two of one group. */
export function validatePairedRoom(room: SeatingRoomAllocation): string | null {
  const benches = room.benches ?? room.capacity;
  const perBench = room.perBench ?? 1;
  const taken = new Set<string>();
  const groupsOnBench = new Map<number, Set<string>>();
  for (const s of room.students) {
    const bench = s.bench ?? 0, seat = s.layer ?? 0;
    if (bench < 1 || bench > benches || seat < 1 || seat > perBench) return `Room ${room.name}: ${s.rollNumber} has no valid bench / seat`;
    const key = `${bench}|${seat}`;
    if (taken.has(key)) return `Room ${room.name}: bench ${bench}${SEAT_LETTERS[seat - 1]} has two students`;
    taken.add(key);
    const g = groupsOnBench.get(bench) ?? new Set<string>();
    if (s.group && g.has(s.group)) return `Room ${room.name}: bench ${bench} has two students of ${s.group}`;
    if (s.group) g.add(s.group);
    groupsOnBench.set(bench, g);
  }
  return null;
}

/** Benches still needed for streams of these sizes in rooms of this many benches each (the longest stream decides). */
export function benchesNeeded(streamSizes: number[]): number {
  return Math.max(0, ...streamSizes);
}
