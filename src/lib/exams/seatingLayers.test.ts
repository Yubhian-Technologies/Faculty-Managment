import { describe, expect, it } from "vitest";
import {
  availableBenches, benchRows, divideIntoGroups, moveStudentLayered, placeInRoom, validateLayeredRoom,
} from "./seatingLayers";
import type { SeatingRoomAllocation, SeatingStudent } from "@/types/examSeating";

const dept = (sectionId: string) => sectionId.split("-")[0]; // "CSE-A" -> CSE
const mk = (sectionId: string, n: number): SeatingStudent[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${sectionId}-${i + 1}`, rollNumber: `${sectionId}${String(i + 1).padStart(2, "0")}`,
    name: `S${i + 1}`, sectionId, sectionLabel: sectionId,
  }));
const room = (name: string, benches: number, perBench: number): SeatingRoomAllocation => ({
  roomId: name, name, block: "A", floor: 2, capacity: benches * perBench, benches, perBench, students: [],
});

describe("layers", () => {
  it("seats two branches on the same benches, one per bench each", () => {
    let r = room("201", 3, 2);
    const a = placeInRoom(r, mk("CSE-A", 3), "CSE", dept);
    if ("error" in a) throw new Error(a.error);
    const b = placeInRoom(a.room, mk("ECE-A", 3), "ECE", dept);
    if ("error" in b) throw new Error(b.error);
    r = b.room;
    expect(benchRows(r).map((row) => row.map((s) => s?.sectionId))).toEqual([
      ["CSE-A", "ECE-A"], ["CSE-A", "ECE-A"], ["CSE-A", "ECE-A"],
    ]);
    expect(validateLayeredRoom(r, dept)).toBeNull();
  });

  it("gives a lone branch only one per bench, even in a 2-per-bench room", () => {
    const r = room("201", 3, 2);
    expect(placeInRoom(r, mk("CSE-A", 4), "CSE", dept)).toHaveProperty("error");
  });

  it("blocks a third branch in a 2-per-bench room, but lets the same branch fill its own leftover benches", () => {
    let r = room("201", 4, 2);
    r = (placeInRoom(r, mk("CSE-A", 2), "CSE", dept) as { room: SeatingRoomAllocation }).room;
    r = (placeInRoom(r, mk("ECE-A", 2), "ECE", dept) as { room: SeatingRoomAllocation }).room;
    expect(placeInRoom(r, mk("EEE-A", 1), "EEE", dept)).toHaveProperty("error");
    expect(availableBenches(r, "CSE", dept)).toBe(2);
    expect(placeInRoom(r, mk("CSE-B", 2), "CSE", dept)).toHaveProperty("room");
  });

  it("divides a section by room benches and moves a student between rooms", () => {
    const { groups, rest } = divideIntoGroups(mk("CSE-A", 70), [30, 30]);
    expect(groups.map((g) => g.length)).toEqual([30, 30]);
    expect(rest).toHaveLength(10);

    const r1 = (placeInRoom(room("201", 2, 2), mk("CSE-A", 2), "CSE", dept) as { room: SeatingRoomAllocation }).room;
    const moved = moveStudentLayered([r1, room("202", 2, 2)], "CSE-A-1", "202", dept);
    if ("error" in moved) throw new Error(moved.error);
    expect(moved.rooms[0].students).toHaveLength(1);
    expect(moved.rooms[1].students[0].layer).toBe(1);
  });
});
