import { describe, expect, it } from "vitest";
import type { SeatingStudent } from "@/types/examSeating";
import { allocatePaired, validatePairedRoom } from "./seatingPaired";

const students = (group: string, n: number): SeatingStudent[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${group}${i + 1}`, rollNumber: `${group}${String(i + 1).padStart(3, "0")}`, name: `${group} ${i + 1}`, sectionId: group, sectionLabel: group, group }));
const room = (n: number) => ({ roomId: `r${n}`, name: `${200 + n}`, block: "A", floor: 2, benches: 24, perBench: 2 });

describe("paired seating", () => {
  it("CSE 210 in seat A, Civil 60 then Mech 60 in seat B, rooms of 24 benches x 2", () => {
    const rooms = Array.from({ length: 9 }, (_, i) => room(i + 1));
    const r = allocatePaired(rooms, [students("CSE", 210), [...students("CIVIL", 60), ...students("MECH", 60)]]);
    expect(r.unplaced).toEqual([]);
    const seatA = (k: number) => r.rooms[k].students.filter((s) => s.layer === 1);
    const seatB = (k: number) => r.rooms[k].students.filter((s) => s.layer === 2);
    // Room 1: bench 1 = CSE 1 + CIVIL 1
    expect(r.rooms[0].students.filter((s) => s.bench === 1).map((s) => s.id)).toEqual(["CSE1", "CIVIL1"]);
    // Room 3: CSE 49-72 with Civil 49-60 then Mech 1-12
    expect(seatA(2).map((s) => s.id)[0]).toBe("CSE49");
    expect(seatB(2).map((s) => s.id).slice(11, 13)).toEqual(["CIVIL60", "MECH1"]);
    // Rooms 6-9: the 90 CSE left sit one per bench (24 + 24 + 24 + 18), seat B empty
    expect([5, 6, 7, 8].map((k) => [seatA(k).length, seatB(k).length])).toEqual([[24, 0], [24, 0], [24, 0], [18, 0]]);
    expect(r.rooms.every((x) => validatePairedRoom(x) === null)).toBe(true);
  });

  it("students the rooms can't hold come back unplaced; a bench never holds one group twice", () => {
    const r = allocatePaired([room(1)], [students("CSE", 30), students("ECE", 10)]);
    expect(r.unplaced.map((s) => s.id)).toEqual(["CSE25", "CSE26", "CSE27", "CSE28", "CSE29", "CSE30"]);
    const bad = { ...r.rooms[0], students: [...r.rooms[0].students.slice(0, 1), { ...r.rooms[0].students[0], id: "x", layer: 2 }] };
    expect(validatePairedRoom(bad)).toContain("two students of CSE");
  });
});

import { shortSection } from "@/lib/pdf/examSeatingTemplate";

describe("seating documents", () => {
  it("print a section short: year, course code, section", () => {
    expect(shortSection("Artificial Intelligence and Data Science · 1st Year · AIDS-A", "B.TECH")).toBe("I B.TECH. AIDS-A");
    expect(shortSection("Civil Engineering · 2nd Year · CE-A")).toBe("II CE-A");
  });
});
