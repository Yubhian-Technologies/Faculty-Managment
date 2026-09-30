import { describe, expect, it } from "vitest";
import { builtInCategories, categoryDocId, categoryKey, checkCategoryDefinition, parseCategoryLines } from "./categoryDefinitions";

const mine = [{ code: "PC", fullForm: "Professional Core" }];

describe("checkCategoryDefinition", () => {
  it("accepts a new code and normalises case and spacing", () => {
    expect(checkCategoryDefinition({ code: " bs&h ", fullForm: "Basic   Sciences and Humanities" }, mine))
      .toEqual({ ok: true, code: "BS&H", fullForm: "Basic Sciences and Humanities" });
  });
  it("rejects bad codes and empty full forms", () => {
    expect(checkCategoryDefinition({ code: "", fullForm: "x y" }, mine)).toMatchObject({ ok: false });
    expect(checkCategoryDefinition({ code: "TOO-LONG-CODE-1", fullForm: "Something" }, mine)).toMatchObject({ ok: false });
    expect(checkCategoryDefinition({ code: "A B", fullForm: "Something" }, mine)).toMatchObject({ ok: false });
    expect(checkCategoryDefinition({ code: "ES", fullForm: "" }, mine)).toMatchObject({ ok: false });
  });
  it("rejects standard categories, however typed", () => {
    expect(checkCategoryDefinition({ code: "pcc", fullForm: "My core" }, mine)).toMatchObject({ ok: false });
    expect(checkCategoryDefinition({ code: "XYZ", fullForm: "Professional Core" }, mine)).toMatchObject({ ok: false });
    expect(checkCategoryDefinition({ code: "Other", fullForm: "Anything" }, mine)).toMatchObject({ ok: false });
  });
  it("rejects a duplicate code or full form, but not the one being edited", () => {
    expect(checkCategoryDefinition({ code: "pc", fullForm: "Different" }, mine)).toMatchObject({ ok: false });
    expect(checkCategoryDefinition({ code: "PCX", fullForm: "professional  core" }, mine)).toMatchObject({ ok: false });
    expect(checkCategoryDefinition({ code: "PC", fullForm: "Professional Core Subjects" }, mine, "PC")).toMatchObject({ ok: true });
  });
});

describe("parseCategoryLines", () => {
  it("reads CODE: Full form, CODE = Full form and tab-separated lines", () => {
    const { entries, errors } = parseCategoryLines("PC: Professional Core\nES = Engineering Sciences\r\n\nPE-I\tProfessional Elective-I\nbroken line");
    expect(entries).toEqual([
      { code: "PC", fullForm: "Professional Core" },
      { code: "ES", fullForm: "Engineering Sciences" },
      { code: "PE-I", fullForm: "Professional Elective-I" },
    ]);
    expect(errors).toEqual(["Line 5: write it as CODE: Full form."]);
  });
});

describe("keys", () => {
  it("treats punctuation and case alike", () => {
    expect(categoryKey("BS&H")).toBe(categoryKey("bs h"));
    expect(categoryDocId("BS&H")).toBe("BS_H");
    expect(categoryDocId("pe-i")).toBe("PE_I");
  });
  it("lists the standard set without Other", () => {
    const codes = builtInCategories().map((c) => c.code);
    expect(codes).toContain("PCC");
    expect(codes).not.toContain("OTHER");
    expect(builtInCategories().find((c) => c.code === "PCC")?.fullForm).toBe("Professional Core");
  });
});
