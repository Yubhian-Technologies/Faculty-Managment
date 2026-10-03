import { describe, expect, it } from "vitest";
import { allocateSeating, moveStudent, sortRoomsForSeating } from "./seatingAllocator";
import type { SeatingStudent } from "@/types/examSeating";

const mk = (sectionId: string, n: number): SeatingStudent[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${sectionId}-${i + 1}`, rollNumber: `${sectionId}${String(i + 1).padStart(2, "0")}`,
    name: `S${i + 1}`, sectionId, sectionLabel: sectionId,
  }));
const room = (name: string, floor: number, capacity: number, allowedSectionIds?: string[]) => ({
  roomId: name, name, block: "A", floor, capacity, allowedSectionIds,
});

describe("allocateSeating", () => {
  it("fills 201, 202, 203 then starts the next floor, spilling the section over", () => {
    const r = allocateSeating(
      [room("301", 3, 20), room("203", 2, 20), room("201", 2, 20), room("202", 2, 20)],
      [{ id: "X", students: mk("X", 70) }]
    );
    expect(r.rooms.map((x) => [x.name, x.students.length])).toEqual([["201", 20], ["202", 20], ["203", 20], ["301", 10]]);
    expect(r.rooms[0].students[0].rollNumber).toBe("X01");
    expect(r.rooms[3].students[0].rollNumber).toBe("X61");
    expect(r.unplaced).toHaveLength(0);
  });

  it("continues the next section in the leftover seats", () => {
    const r = allocateSeating([room("201", 2, 20), room("202", 2, 20)], [
      { id: "X", students: mk("X", 25) }, { id: "Y", students: mk("Y", 10) },
    ]);
    expect(r.rooms[1].students.map((s) => s.sectionId)).toEqual([...Array(5).fill("X"), ...Array(10).fill("Y")]);
  });

  it("respects handpicked sections per room and reports the unplaced", () => {
    const r = allocateSeating([room("201", 2, 20, ["Y"]), room("202", 2, 20, ["X"])], [
      { id: "X", students: mk("X", 30) }, { id: "Y", students: mk("Y", 5) },
    ]);
    expect(r.rooms[0].students.every((s) => s.sectionId === "Y")).toBe(true);
    expect(r.rooms[1].students).toHaveLength(20);
    expect(r.unplaced).toHaveLength(10);
  });
});

describe("helpers", () => {
  it("sorts rooms by block, floor, then number", () => {
    expect(sortRoomsForSeating([{ name: "301", block: "A", floor: 3 }, { name: "102", block: "A", floor: 1 }, { name: "101", block: "A", floor: 1 }]).map((r) => r.name))
      .toEqual(["101", "102", "301"]);
  });

  it("refuses a move into a full room", () => {
    const plan = allocateSeating([room("201", 2, 1), room("202", 2, 1)], [{ id: "X", students: mk("X", 2) }]);
    expect(moveStudent(plan, "X-1", "202")).toBeNull();
    expect(moveStudent(plan, "X-1", "UNPLACED")?.unplaced).toHaveLength(1);
  });
});
