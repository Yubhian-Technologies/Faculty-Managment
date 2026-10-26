import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudentDepartmentCell } from "./StudentDepartmentCell";
import { DETAIL_ROSTER_FIELDS, EDITABLE_ROSTER_FIELDS, LIST_ROSTER_FIELDS, ROSTER_FIELDS } from "@/lib/students/rosterFields";

const html = (department?: string | null, core?: string | null) =>
  renderToStaticMarkup(createElement(StudentDepartmentCell, { department, coreDepartment: core }));

describe("StudentDepartmentCell", () => {
  it("a student with no core department shows only the department", () => {
    const out = html("Computer Science and Engineering", "");
    expect(out).toContain("Computer Science and Engineering");
    expect(out).not.toContain("Core");
    expect(html("Information Technology", undefined)).not.toContain("Core");
    expect(html("Information Technology", null)).not.toContain("Core");
    expect(html("Information Technology", "   ")).not.toContain("Core");
  });

  it("a student with a core department shows it under the department, tagged Core", () => {
    const out = html("Basic Science", "Electronics and Communication Engineering");
    expect(out).toContain("Basic Science");
    expect(out).toContain("Electronics and Communication Engineering");
    expect(out).toContain(">Core<");
    expect(out.indexOf("Basic Science")).toBeLessThan(out.indexOf("Electronics and Communication Engineering"));
  });

  it("shows a dash when there is nothing at all", () => {
    expect(html("", "")).toContain("—");
  });
});

describe("students list columns", () => {
  it("the Core Department column is gone from the list, the Department column stays", () => {
    expect(LIST_ROSTER_FIELDS.map((f) => f.key)).not.toContain("secondaryDepartment");
    expect(LIST_ROSTER_FIELDS.map((f) => f.key)).toContain("department");
  });

  it("Core Department is still a real field everywhere else (forms, details, import, export keep it)", () => {
    expect(ROSTER_FIELDS.some((f) => f.key === "secondaryDepartment" && f.label === "Core Department")).toBe(true);
    expect(EDITABLE_ROSTER_FIELDS.some((f) => f.key === "secondaryDepartment")).toBe(true);
    expect(DETAIL_ROSTER_FIELDS.some((f) => f.key === "secondaryDepartment")).toBe(false); // it was a primary (identity) field before too
  });
});
