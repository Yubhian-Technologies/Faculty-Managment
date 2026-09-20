import { describe, expect, it } from "vitest";
import { DEPARTMENT_REF_FIELDS } from "./refFields";
import { DEPARTMENT_REF_FIELDS as SCRIPT_FIELDS } from "../../../scripts/lib/departmentRefs.mjs";

const key = (e: { collection: string; field: string; idField: string; kind: string }) =>
  `${e.collection}|${e.field}|${e.idField}|${e.kind}`;

describe("department ref field catalog", () => {
  it("src/lib/departments/refFields.ts and scripts/lib/departmentRefs.mjs list the same fields", () => {
    const a = DEPARTMENT_REF_FIELDS.map(key).sort();
    const b = (SCRIPT_FIELDS as { collection: string; field: string; idField: string; kind: string }[]).map(key).sort();
    expect(a).toEqual(b);
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
