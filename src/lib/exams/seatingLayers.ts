import { sortByRoll } from "@/lib/exams/seatingAllocator";
import type { SeatingRoomAllocation, SeatingStudent } from "@/types/examSeating";

// Bench layers: a room with N students per bench has N layers. One layer is
// one seat position on every bench and belongs to a single branch, so students
// sharing a bench are always from different branches, and one branch alone in
// a room gets at most one student per bench.

export type DeptOf = (sectionId: string) => string;

const benchesOf = (r: Pick<SeatingRoomAllocation, "benches" | "capacity">) => r.benches ?? r.capacity;
const perBenchOf = (r: Pick<SeatingRoomAllocation, "perBench">) => r.perBench ?? 1;

export function layerStudents(room: SeatingRoomAllocation, layer: number): SeatingStudent[] {
  return room.students.filter((s) => (s.layer ?? 1) === layer);
}

function layerOwner(room: SeatingRoomAllocation, layer: number, deptOf: DeptOf): string | null {
  const first = layerStudents(room, layer)[0];
  return first ? deptOf(first.sectionId) : null;
}

// How many benches a branch could still fill in this room: the free benches of
// its own layer if it already has one, else a whole layer when one is empty,
// else none.
export function availableBenches(room: SeatingRoomAllocation, dept: string, deptOf: DeptOf): number {
  const benches = benchesOf(room);
  for (let l = 1; l <= perBenchOf(room); l++) {
    if (layerOwner(room, l, deptOf) === dept) return benches - layerStudents(room, l).length;
  }
  for (let l = 1; l <= perBenchOf(room); l++) {
    if (layerStudents(room, l).length === 0) return benches;
  }
  return 0;
}

// Puts `students` (one branch) into the room; null + reason when it can't.
export function placeInRoom(
  room: SeatingRoomAllocation,
  students: SeatingStudent[],
  dept: string,
  deptOf: DeptOf
): { room: SeatingRoomAllocation } | { error: string } {
  if (students.length === 0) return { room };
  let layer = 0;
  for (let l = 1; l <= perBenchOf(room); l++) {
    if (layerOwner(room, l, deptOf) === dept) { layer = l; break; }
  }
  if (!layer) {
    for (let l = 1; l <= perBenchOf(room); l++) {
      if (layerStudents(room, l).length === 0) { layer = l; break; }
    }
  }
  if (!layer) return { error: `Room ${room.name} has no free bench layer for ${dept}` };
  const free = benchesOf(room) - layerStudents(room, layer).length;
  if (students.length > free) {
    return { error: `Room ${room.name} has only ${free} free bench(es) for ${dept}, ${students.length} students given` };
  }
  return {
    room: { ...room, students: [...room.students, ...sortByRoll(students).map((s) => ({ ...s, layer }))] },
  };
}

// Every layer of every room keeps to one branch and within the bench count.
export function validateLayeredRoom(room: SeatingRoomAllocation, deptOf: DeptOf): string | null {
  for (let l = 1; l <= perBenchOf(room); l++) {
    const list = layerStudents(room, l);
    if (list.length > benchesOf(room)) return `Room ${room.name} has more students than benches in layer ${l}`;
    if (new Set(list.map((s) => deptOf(s.sectionId))).size > 1) return `Room ${room.name}: two branches share a layer`;
  }
  const maxLayer = Math.max(1, ...room.students.map((s) => s.layer ?? 1));
  if (maxLayer > perBenchOf(room)) return `Room ${room.name} has only ${perBenchOf(room)} per bench`;
  const owners = Array.from({ length: perBenchOf(room) }, (_, i) => layerOwner(room, i + 1, deptOf)).filter(Boolean);
  if (new Set(owners).size !== owners.length) return `Room ${room.name}: the same branch sits on two layers`;
  return null;
}

// Review-time move of one student into another room (or out of the plan's
// rooms entirely is not allowed in layered mode - every allotted student stays
// seated somewhere).
export function moveStudentLayered(
  rooms: SeatingRoomAllocation[],
  studentId: string,
  targetRoomId: string,
  deptOf: DeptOf
): { rooms: SeatingRoomAllocation[] } | { error: string } {
  const source = rooms.find((r) => r.students.some((s) => s.id === studentId));
  const student = source?.students.find((s) => s.id === studentId);
  if (!source || !student) return { error: "Student not found" };
  if (source.roomId === targetRoomId) return { rooms };
  const target = rooms.find((r) => r.roomId === targetRoomId);
  if (!target) return { error: "Room not found" };
  const placed = placeInRoom(target, [{ ...student, layer: undefined }], deptOf(student.sectionId), deptOf);
  if ("error" in placed) return placed;
  return {
    rooms: rooms.map((r) =>
      r.roomId === targetRoomId ? placed.room
        : r.roomId === source.roomId ? { ...r, students: r.students.filter((s) => s.id !== studentId) }
        : r
    ),
  };
}

// Splits one section's students into groups sized by the benches of the rooms
// they're headed to, in roll order; whoever is left over comes back in `rest`.
export function divideIntoGroups(
  students: SeatingStudent[],
  sizes: number[]
): { groups: SeatingStudent[][]; rest: SeatingStudent[] } {
  const sorted = sortByRoll(students);
  const groups: SeatingStudent[][] = [];
  let at = 0;
  for (const size of sizes) {
    groups.push(sorted.slice(at, at + Math.max(0, size)));
    at += Math.max(0, size);
  }
  return { groups, rest: sorted.slice(at) };
}

// One row per bench, one cell per layer - what the review table and the print
// sheet show.
export function benchRows(room: SeatingRoomAllocation): (SeatingStudent | null)[][] {
  const layers = Array.from({ length: perBenchOf(room) }, (_, i) => sortByRoll(layerStudents(room, i + 1)));
  const count = Math.max(0, ...layers.map((l) => l.length));
  return Array.from({ length: count }, (_, b) => layers.map((l) => l[b] ?? null));
}
