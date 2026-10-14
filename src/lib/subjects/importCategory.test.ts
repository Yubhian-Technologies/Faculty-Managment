import { describe, it, expect } from "vitest";
import { resolveImportCategory } from "./importCategory";

describe("resolveImportCategory", () => {
  const mine = [{ code: "PC", fullForm: "Professional Core" }, { code: "BS&H", fullForm: "Basic Sciences and Humanities" }];

  it("accepts standard codes and labels", () => {
    expect(resolveImportCategory("pcc")).toEqual({ kind: "known", category: "PCC" });
    expect(resolveImportCategory("Professional Core")).toEqual({ kind: "known", category: "PCC" });
    expect(resolveImportCategory("Professional Core (PCC)")).toEqual({ kind: "known", category: "PCC" });
  });
  it("accepts categories the college defined, by code or full form", () => {
    expect(resolveImportCategory("pc", mine)).toEqual({ kind: "known", category: "PC" });
    expect(resolveImportCategory("BS&H", mine)).toEqual({ kind: "known", category: "BS&H" });
    expect(resolveImportCategory("basic sciences and humanities", mine)).toEqual({ kind: "known", category: "BS&H" });
  });
  it("treats anything undefined as unknown, with a suggestion when one is close", () => {
    expect(resolveImportCategory("PC")).toEqual({ kind: "unknown", suggestion: "PCC" });
    expect(resolveImportCategory("PCCC")).toEqual({ kind: "unknown", suggestion: "PCC" });
    expect(resolveImportCategory("Professional Elective-II")).toEqual({ kind: "unknown", suggestion: "PEC" });
    expect(resolveImportCategory("Open Elective-IV")).toEqual({ kind: "unknown", suggestion: "OEC" });
    expect(resolveImportCategory("SEC")).toEqual({ kind: "unknown" });
    expect(resolveImportCategory("Audit Course", mine)).toEqual({ kind: "unknown" });
  });
});
