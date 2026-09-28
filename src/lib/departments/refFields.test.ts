import { describe, expect, it } from "vitest";
import { DEPARTMENT_REF_FIELDS } from "./refFields";

describe("department ref field catalog", () => {
  it("contains valid definitions", () => {
    expect(DEPARTMENT_REF_FIELDS.length).toBeGreaterThan(0);
    for (const e of DEPARTMENT_REF_FIELDS) {
      expect(e.collection).toBeTruthy();
      expect(e.field).toBeTruthy();
      expect(e.idField).toBeTruthy();
      expect(["scalar", "array", "nestedScopes"]).toContain(e.kind);
    }
  });

  it("has no duplicate (collection, field) pairs", () => {
    const seen = new Set<string>();
    for (const e of DEPARTMENT_REF_FIELDS) {
      const k = `${e.collection}|${e.field}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });
});
