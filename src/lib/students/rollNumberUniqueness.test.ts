import { describe, it, expect } from "vitest";
import { createRollRegistry, findRollNumberConflict, normalizeRoll, rollKey, rollNumberTakenMessage } from "@/lib/students/rollNumberUniqueness";

describe("roll normalisation", () => {
  it("trims and lowercases, blanks stay blank", () => {
    expect(normalizeRoll("  24PA1A0501 ")).toBe("24PA1A0501");
    expect(rollKey(" 24pa1a0501 ")).toBe("24pa1a0501");
    expect(rollKey(undefined)).toBe("");
    expect(rollKey("   ")).toBe("");
    expect(rollKey(42 as unknown)).toBe("");
  });
});

describe("createRollRegistry (importers)", () => {
  const existing = [
    { id: "s1", rollNumber: "24PA1A0501", name: "Anil" },
    { id: "s2", rollNumber: "", name: "No Roll" },
    { id: "s3", name: "Undefined Roll" },
  ];

  it("finds a roll held by ANY existing student, case-insensitively", () => {
    const reg = createRollRegistry(existing);
    expect(reg.holder("24pa1a0501")).toEqual({ id: "s1", name: "Anil" });
    expect(reg.holder(" 24PA1A0501 ")?.name).toBe("Anil");
  });

  it("never treats blank or unknown rolls as taken", () => {
    const reg = createRollRegistry(existing);
    expect(reg.holder("")).toBeNull();
    expect(reg.holder(undefined)).toBeNull();
    expect(reg.holder("24PA1A0999")).toBeNull();
  });

  it("rejects a second row in the same file once the first is claimed", () => {
    const reg = createRollRegistry(existing);
    expect(reg.holder("24PA1A0777")).toBeNull();
    reg.claim("24PA1A0777", "Row One");
    expect(reg.holder("24pa1a0777")?.name).toBe("Row One");
  });

  it("claiming a blank roll does nothing", () => {
    const reg = createRollRegistry([]);
    reg.claim("", "Nobody");
    expect(reg.holder("")).toBeNull();
  });
});

describe("findRollNumberConflict (single edits)", () => {
  const fake = (rows: { id: string; rollNumber: string; name: string }[]) => ({
    where(_f: string, _op: "==", value: string) {
      return {
        async get() {
          return { docs: rows.filter((r) => r.rollNumber === value).map((r) => ({ id: r.id, data: () => ({ name: r.name, rollNumber: r.rollNumber }) })) };
        },
      };
    },
  });
  const rows = [
    { id: "a", rollNumber: "R1", name: "Alpha" },
    { id: "b", rollNumber: "R2", name: "Beta" },
  ];

  it("returns the other holder", async () => {
    expect(await findRollNumberConflict(fake(rows), "R1", "b")).toEqual({ id: "a", name: "Alpha" });
  });

  it("ignores the student being edited (re-saving their own roll)", async () => {
    expect(await findRollNumberConflict(fake(rows), "R1", "a")).toBeNull();
  });

  it("free roll and blank roll are conflict-free", async () => {
    expect(await findRollNumberConflict(fake(rows), "R9", "a")).toBeNull();
    expect(await findRollNumberConflict(fake(rows), "  ", "a")).toBeNull();
  });

  it("message names the holder", () => {
    expect(rollNumberTakenMessage("R1", "Alpha")).toContain("Alpha");
    expect(rollNumberTakenMessage("R1")).toContain("another student");
  });
});
