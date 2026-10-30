import { describe, expect, it } from "vitest";
import { cleanFacultyOrder } from "./facultyOrder";
import { moveToPosition } from "./arrangeMove";
import { compareDefaultFacultyOrder } from "./listOrder";
import { compareFacultyForList } from "./sortFacultyForList";

const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, legalName: id, department: "CSE", ...extra });
const ids = (rows: ReturnType<typeof row>[], cmp: (a: unknown, b: unknown) => number) => [...rows].sort(cmp).map((r) => r.id);

describe("HOD arranged order", () => {
  it("puts arranged rows first in position order, ahead of the default HOD-first rule", () => {
    const rows = [
      row("hod", { seatRoleCodes: ["HOD"], orderRank: 2 }),
      row("b", { orderRank: 0 }),
      row("a", { orderRank: 1 }),
    ];
    expect(ids(rows, compareDefaultFacultyOrder)).toEqual(["b", "a", "hod"]);
  });

  it("leaves a member the order doesn't name (tied rank) after the named ones, in the default order", () => {
    const rows = [row("zed", { orderRank: 2 }), row("amy", { orderRank: 2 }), row("first", { orderRank: 0 })];
    expect(ids(rows, compareDefaultFacultyOrder)).toEqual(["first", "amy", "zed"]);
  });

  it("keeps the default order for rows with no rank, after arranged rows (another department)", () => {
    const rows = [row("plain", { department: "ECE" }), row("arranged", { orderRank: 0 })];
    expect(ids(rows, compareDefaultFacultyOrder)).toEqual(["arranged", "plain"]);
  });

  it("is honoured by the plain-list comparator too, ahead of the department HOD", () => {
    const rows = [row("hod", { userUid: "u1" }), row("x", { orderRank: 0 })];
    expect(ids(rows, compareFacultyForList("u1"))).toEqual(["x", "hod"]);
  });
});

describe("moveToPosition", () => {
  const list = ["a", "b", "c", "d"];

  it("moves a card down to the position of the one it is dropped on", () => {
    expect(moveToPosition(list, "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a card up to the position of the one it is dropped on", () => {
    expect(moveToPosition(list, "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("returns the same list for a drop on itself or an unknown id", () => {
    expect(moveToPosition(list, "b", "b")).toBe(list);
    expect(moveToPosition(list, "b", "zzz")).toBe(list);
  });
});

describe("cleanFacultyOrder", () => {
  const valid = new Set(["a", "b", "c"]);

  it("keeps order, drops unknown ids, non-strings and repeats", () => {
    expect(cleanFacultyOrder(["c", "zzz", "a", 5, "c", "b"], valid)).toEqual(["c", "a", "b"]);
  });

  it("answers null for a non-array body", () => {
    expect(cleanFacultyOrder("a", valid)).toBeNull();
  });

  it("accepts an empty list (reset)", () => {
    expect(cleanFacultyOrder([], valid)).toEqual([]);
  });
});
