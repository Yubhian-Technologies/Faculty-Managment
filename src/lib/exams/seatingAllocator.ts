import type {
  ExamRoom, SeatingRoomAllocation, SeatingStudent,
} from "@/types/examSeating";

const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

// Rooms in walking order: block, then floor, then room number - so 201, 202,
// 203 are adjacent and the next room after them is the first one on the next
// floor (301).
export function sortRoomsForSeating<T extends Pick<ExamRoom, "name" | "block" | "floor">>(rooms: T[]): T[] {
  return [...rooms].sort(
    (a, b) => naturalCompare(a.block, b.block) || a.floor - b.floor || naturalCompare(a.name, b.name)
  );
}

export function sortByRoll<T extends { rollNumber: string }>(students: T[]): T[] {
  return [...students].sort((a, b) => naturalCompare(a.rollNumber, b.rollNumber));
}

export interface AllocatorSection {
  id: string;
  students: SeatingStudent[];
}

export interface AllocatorRoom {
  roomId: string;
  name: string;
  block: string;
  floor: number;
  capacity: number;
  allowedSectionIds?: string[];
}

// Fills rooms in walking order. Within a room, sections are drawn on in the
// order given (roll number 1 first, a section may spill into the next room),
// restricted to the sections Exam Cell handpicked for that room when it named
// any. Anyone who fits nowhere comes back in `unplaced` for Exam Cell to
// resolve in review.
export function allocateSeating(
  rooms: AllocatorRoom[],
  sections: AllocatorSection[]
): { rooms: SeatingRoomAllocation[]; unplaced: SeatingStudent[] } {
  const queues = sections.map((s) => ({ id: s.id, students: sortByRoll(s.students), next: 0 }));
  const out: SeatingRoomAllocation[] = sortRoomsForSeating(rooms).map((room) => {
    const allowed = room.allowedSectionIds?.length ? new Set(room.allowedSectionIds) : null;
    const students: SeatingStudent[] = [];
    for (const q of queues) {
      if (allowed && !allowed.has(q.id)) continue;
      while (students.length < room.capacity && q.next < q.students.length) {
        students.push(q.students[q.next++]);
      }
      if (students.length >= room.capacity) break;
    }
    return { ...room, students };
  });
  const unplaced = queues.flatMap((q) => q.students.slice(q.next));
  return { rooms: out, unplaced };
}

// Moves one student between rooms (or out to / back from `unplaced`),
// enforcing capacity. Returns null when the target room is full.
export function moveStudent(
  plan: { rooms: SeatingRoomAllocation[]; unplaced: SeatingStudent[] },
  studentId: string,
  targetRoomId: string | "UNPLACED"
): { rooms: SeatingRoomAllocation[]; unplaced: SeatingStudent[] } | null {
  let student: SeatingStudent | undefined;
  const rooms = plan.rooms.map((r) => {
    const found = r.students.find((s) => s.id === studentId);
    if (!found) return r;
    student = found;
    return { ...r, students: r.students.filter((s) => s.id !== studentId) };
  });
  let unplaced = plan.unplaced;
  if (!student) {
    student = plan.unplaced.find((s) => s.id === studentId);
    if (!student) return null;
    unplaced = plan.unplaced.filter((s) => s.id !== studentId);
  }
  if (targetRoomId === "UNPLACED") return { rooms, unplaced: [...unplaced, student] };
  const target = rooms.find((r) => r.roomId === targetRoomId);
  if (!target || target.students.length >= target.capacity) return null;
  return {
    rooms: rooms.map((r) =>
      r.roomId === targetRoomId ? { ...r, students: sortByRoll([...r.students, student!]) } : r
    ),
    unplaced,
  };
}

export function rollRangeBySection(students: SeatingStudent[]): { sectionLabel: string; from: string; to: string; count: number }[] {
  const groups = new Map<string, SeatingStudent[]>();
  for (const s of sortByRoll(students)) {
    groups.set(s.sectionLabel, [...(groups.get(s.sectionLabel) ?? []), s]);
  }
  return Array.from(groups, ([sectionLabel, list]) => ({
    sectionLabel, from: list[0].rollNumber, to: list[list.length - 1].rollNumber, count: list.length,
  }));
}

// Same block + room name is the same room, so re-uploading a sheet updates
// capacities instead of duplicating rows.
export function examRoomDocId(block: string, name: string): string {
  return `${block}__${name}`.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}
