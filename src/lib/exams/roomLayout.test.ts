import { describe, expect, it } from "vitest";
import { benchPosition, columnsError, roomColumns, roomRows } from "./roomLayout";
import { allocatePaired } from "./seatingPaired";
import type { SeatingStudent } from "@/types/examSeating";

describe("room bench columns", () => {
  it("4 columns x 6 rows: benches numbered column by column", () => {
    expect(roomRows(24, 4)).toBe(6);
    expect(benchPosition(1, 24, 4)).toEqual({ column: 1, row: 1 });
    expect(benchPosition(6, 24, 4)).toEqual({ column: 1, row: 6 });
    expect(benchPosition(7, 24, 4)).toEqual({ column: 2, row: 1 });
    expect(benchPosition(24, 24, 4)).toEqual({ column: 4, row: 6 });
  });

  it("uneven rooms: 30 benches in 4 columns = 8 rows, the last column shorter", () => {
    expect(roomRows(30, 4)).toBe(8);
    expect(benchPosition(30, 30, 4)).toEqual({ column: 4, row: 6 });
  });

  it("columns are optional, whole, and no more than the benches", () => {
    expect(roomColumns({ benches: 24, capacity: 48 })).toBeUndefined();
    expect(roomColumns({ benches: 24, columns: 4, capacity: 48 })).toBe(4);
    expect(columnsError(0, 24)).toMatch(/at least 1/);
    expect(columnsError(2.5, 24)).toMatch(/whole/);
    expect(columnsError(25, 24)).toMatch(/more than the benches/);
    expect(columnsError(4, 24)).toBeNull();
  });

  it("paired seating fills column 1 front to back first and keeps the columns", () => {
    const st = (n: number): SeatingStudent[] => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, rollNumber: `R${i}`, name: "", sectionId: "x", sectionLabel: "x", group: "G" }));
    const r = allocatePaired([{ roomId: "r", name: "201", block: "A", floor: 2, benches: 24, perBench: 1, columns: 4 }], [st(8)]);
    expect(r.rooms[0].columns).toBe(4);
    expect(r.rooms[0].students.map((s) => benchPosition(s.bench!, 24, 4).column)).toEqual([1, 1, 1, 1, 1, 1, 2, 2]);
  });
});
