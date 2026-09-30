import { describe, it, expect } from "vitest";
import { compareStudentsForList, sortStudentsForList } from "@/lib/students/listOrder";

const S = (id: string, name: string, rollNumber?: string) => ({ id, name, rollNumber });
const names = (list: { name: string }[]) => list.map((s) => s.name);

describe("compareStudentsForList", () => {
  it("orders by roll number", () => {
    const list = [S("1", "Zed", "24PA1A0503"), S("2", "Amy", "24PA1A0501"), S("3", "Bob", "24PA1A0502")];
    expect(names(sortStudentsForList(list))).toEqual(["Amy", "Bob", "Zed"]);
  });

  it("compares rolls naturally, not as text (2 before 10)", () => {
    const list = [S("1", "C", "R10"), S("2", "A", "R2"), S("3", "B", "R1")];
    expect(names(sortStudentsForList(list))).toEqual(["B", "A", "C"]);
  });

  it("is case-insensitive on the roll", () => {
    const list = [S("1", "B", "24pa1a0502"), S("2", "A", "24PA1A0501")];
    expect(names(sortStudentsForList(list))).toEqual(["A", "B"]);
  });

  it("puts students with no roll number after numbered ones, ordered by name", () => {
    const list = [
      S("1", "Ravi Teja"),
      S("2", "Patel Pranav", "3241"),
      S("3", "B. Anusha", ""),
      S("4", "Kumar Sai", "3242"),
      S("5", "K. Rahul", "  "),
    ];
    expect(names(sortStudentsForList(list))).toEqual(["Patel Pranav", "Kumar Sai", "B. Anusha", "K. Rahul", "Ravi Teja"]);
  });

  it("orders an entirely roll-less list by name", () => {
    const list = [S("1", "Ravi Sai"), S("2", "Ravi Kiran"), S("3", "B. Anusha")];
    expect(names(sortStudentsForList(list))).toEqual(["B. Anusha", "Ravi Kiran", "Ravi Sai"]);
  });

  it("breaks exact ties by id so the order is deterministic", () => {
    const a = S("a", "Same", "1");
    const b = S("b", "Same", "1");
    expect(compareStudentsForList(a, b)).toBeLessThan(0);
    expect(compareStudentsForList(b, a)).toBeGreaterThan(0);
  });

  it("tolerates missing fields", () => {
    expect(() => sortStudentsForList([{}, { rollNumber: null, name: null }, S("1", "X", "1")])).not.toThrow();
  });
});
