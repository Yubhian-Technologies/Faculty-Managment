import { describe, it, expect } from "vitest";
import { compareStudentsBySectionThenRoll, compareStudentsForList, sortStudentsForList } from "@/lib/students/listOrder";

const S = (id: string, name: string, rollNumber?: string) => ({ id, name, rollNumber });
const names = (list: { name: string }[]) => list.map((s) => s.name);

describe("compareStudentsForList", () => {
  it("orders by Regd. No", () => {
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

  it("puts students with no Regd. No after numbered ones, ordered by name", () => {
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

describe("compareStudentsBySectionThenRoll", () => {
  const T = (id: string, name: string, section?: string | null, rollNumber?: string, year?: number | string | null) => ({ id, name, section, rollNumber, year });
  const sorted = (list: ReturnType<typeof T>[]) => list.sort(compareStudentsBySectionThenRoll).map((s) => s.id);

  it("groups by section, then orders by Regd. No inside each", () => {
    const list = [
      T("b2", "B2", "B", "R2"), T("a2", "A2", "A", "R2"), T("b1", "B1", "B", "R1"), T("a1", "A1", "A", "R1"), T("a3", "A3", "A", "R3"),
    ];
    expect(sorted(list)).toEqual(["a1", "a2", "a3", "b1", "b2"]);
  });

  it("orders section names naturally (2 before 10) and ignoring case", () => {
    expect(sorted([T("x", "X", "10", "1"), T("y", "Y", "2", "1"), T("z", "Z", "a", "1"), T("w", "W", "B", "1")])).toEqual(["y", "x", "z", "w"]);
  });

  it("puts students in no section after every named section, in Regd. No order", () => {
    const list = [T("n2", "N2", "", "R2"), T("a1", "A1", "A", "R9"), T("n1", "N1", undefined, "R1"), T("n3", "N3", "  ", "R3"), T("n0", "N0", null, "R0")];
    expect(sorted(list)).toEqual(["a1", "n0", "n1", "n2", "n3"]);
  });

  it("keeps the roll-less-last and name rules inside a section", () => {
    const list = [T("c", "Zed", "A"), T("b", "Amy", "A"), T("a", "Pat", "A", "R1")];
    expect(sorted(list)).toEqual(["a", "b", "c"]);
  });

  it("is a total order - ties fall to id - and leaves compareStudentsForList alone", () => {
    expect(compareStudentsBySectionThenRoll(T("a", "S", "A", "1"), T("b", "S", "A", "1"))).toBeLessThan(0);
    // The shared comparator still ignores section entirely.
    expect(compareStudentsForList(T("1", "X", "B", "R1"), T("2", "Y", "A", "R2"))).toBeLessThan(0);
  });

  it("orders by year first - 1st, 2nd, 3rd, 4th - whatever the section or Regd. No", () => {
    const list = [
      T("y4", "Y4", "CE-A", "23B01A0101", 4), T("y1b", "Y1B", "CE", "26BV1A01060", 1), T("y2", "Y2", "A", "25B01A0101", 2),
      T("y1a", "Y1A", "CE", "26BV1A01055", 1), T("y3", "Y3", "A", "24B01A0101", 3),
    ];
    expect(sorted(list)).toEqual(["y1a", "y1b", "y2", "y3", "y4"]);
  });

  it("then section, then Regd. No inside a year, and unplaced last in their year", () => {
    const list = [
      T("2b", "x", "B", "R1", 2), T("1u", "x", "", "R1", 1), T("2a", "x", "A", "R9", 2), T("1a", "x", "A", "R2", 1), T("2u", "x", null, "R0", 2),
    ];
    expect(sorted(list)).toEqual(["1a", "1u", "2a", "2b", "2u"]);
  });

  it("reads a year stored as text, and puts a missing year after every year", () => {
    const list = [T("none", "x", "A", "R1"), T("two", "x", "A", "R1", "2"), T("zero", "x", "A", "R1", 0), T("one", "x", "A", "R1", 1)];
    expect(sorted(list)).toEqual(["one", "two", "none", "zero"]);
  });

  describe("serials that run on past 99", () => {
    const rolls = (list: string[]) => sorted(list.map((r) => T(r, r, "A", r, 1)));

    it("continues A0-A9, B0-B9 after 99, in a department's own series", () => {
      expect(rolls(["26PA1A04B0", "26PA1A0499", "26PA1A04A9", "26PA1A0401", "26PA1A04A0", "26PA1A04B1", "26PA1A0410"]))
        .toEqual(["26PA1A0401", "26PA1A0410", "26PA1A0499", "26PA1A04A0", "26PA1A04A9", "26PA1A04B0", "26PA1A04B1"]);
    });

    it("runs 3-digit serials on numerically after 99 (100, 101 ...)", () => {
      expect(rolls(["26BV1A05101", "26BV1A05099", "26BV1A05100", "26BV1A05055", "26BV1A05151"]))
        .toEqual(["26BV1A05055", "26BV1A05099", "26BV1A05100", "26BV1A05101", "26BV1A05151"]);
    });

    it("never lets one branch's long serials spill into the next branch (all-digit serials before letter ones)", () => {
      expect(rolls(["26BV1A0601", "26BV1A05151", "26BV1A05A0", "26BV1A0599", "26BV1A0501"]))
        .toEqual(["26BV1A0501", "26BV1A0599", "26BV1A05151", "26BV1A05A0", "26BV1A0601"]);
    });

    it("orders batches by the prefix, and is case-insensitive", () => {
      expect(rolls(["26pa1a0101", "24PA1A0199", "25PA1A0101", "24pa1a01a0"])).toEqual(["24PA1A0199", "24pa1a01a0", "25PA1A0101", "26pa1a0101"]);
    });

    it("keeps rolls of another shape after the standard ones, in natural order", () => {
      expect(rolls(["R10", "26PA1A0101", "R2", "3241", "26CSE006"])).toEqual(["26PA1A0101", "26CSE006", "3241", "R2", "R10"]);
    });

    it("is a consistent order whatever the input order", () => {
      const base = ["26PA1A0401", "26PA1A0499", "26PA1A04A0", "26PA1A05100", "26PA1A0601", "R2", "R10", "3241"];
      const expected = rolls([...base]);
      for (let i = 0; i < 20; i++) {
        expect(rolls([...base].sort(() => Math.random() - 0.5))).toEqual(expected);
      }
    });
  });
});

