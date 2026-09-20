import { describe, expect, it } from "vitest";
import {
  buildDepartmentIndex,
  canonicalDepartmentName,
  findDepartmentConflict,
  normalizeDepartmentCode,
  normalizeDepartmentName,
  resolveDepartmentId,
} from "./resolve";

const depts = [
  { id: "d1", name: "Computer Science and Engineering", code: "CSE" },
  { id: "d2", name: "Information Technology", code: "IT" },
  { id: "d3", name: "Electronics and Communication Engineering", code: "ECE" },
];

describe("normalization", () => {
  it("collapses whitespace, NBSP and case in names", () => {
    const k = normalizeDepartmentName("Computer Science");
    expect(normalizeDepartmentName("  computer   science ")).toBe(k);
    expect(normalizeDepartmentName("COMPUTER SCIENCE")).toBe(k);
    expect(normalizeDepartmentName("Computer\tScience")).toBe(k);
  });
  it("strips all whitespace and uppercases codes", () => {
    expect(normalizeDepartmentCode(" c s e ")).toBe("CSE");
    expect(normalizeDepartmentCode("cse")).toBe("CSE");
  });
  it("canonical name keeps case but collapses spaces", () => {
    expect(canonicalDepartmentName("  Civil   Engineering ")).toBe("Civil Engineering");
  });
});

describe("resolveDepartmentId", () => {
  const index = buildDepartmentIndex(depts);
  it("resolves by id, name (any case/space) and code", () => {
    expect(resolveDepartmentId(index, "d2")).toMatchObject({ ok: true, id: "d2", via: "id" });
    expect(resolveDepartmentId(index, " information   technology ")).toMatchObject({ ok: true, id: "d2", via: "name" });
    expect(resolveDepartmentId(index, "cse")).toMatchObject({ ok: true, id: "d1", via: "code" });
  });
  it("reports blank / none", () => {
    expect(resolveDepartmentId(index, "  ")).toEqual({ ok: false, reason: "blank" });
    expect(resolveDepartmentId(index, "Mechanical")).toEqual({ ok: false, reason: "none" });
  });
  it("reports ambiguous for pre-existing bad data instead of guessing", () => {
    const bad = buildDepartmentIndex([
      { id: "a", name: "Physics", code: "PHY" },
      { id: "b", name: "PHY", code: "P2" }, // b's name equals a's code
      { id: "c", name: "physics", code: "PH3" }, // duplicate name
    ]);
    expect(resolveDepartmentId(bad, "phy")).toMatchObject({ ok: false, reason: "ambiguous" });
    expect(resolveDepartmentId(bad, "Physics")).toMatchObject({ ok: false, reason: "ambiguous" });
  });
});

describe("findDepartmentConflict (create / rename)", () => {
  it("rejects duplicate names: exact, case, spaces, NBSP", () => {
    for (const name of [
      "Information Technology",
      "information technology",
      "  Information Technology  ",
      "Information   Technology",
      "Information Technology",
    ]) {
      expect(findDepartmentConflict(depts, { name })).toMatchObject({ field: "name", existingId: "d2" });
    }
  });
  it("rejects duplicate codes: exact, lowercase, spaced", () => {
    for (const code of ["IT", "it", " i t "]) {
      expect(findDepartmentConflict(depts, { code })).toMatchObject({ field: "code", existingId: "d2" });
    }
  });
  it("rejects a name equal to another's code and a code equal to another's name", () => {
    expect(findDepartmentConflict(depts, { name: "cse" })).toMatchObject({ field: "name", existingId: "d1" });
    expect(findDepartmentConflict(depts, { code: "Information Technology" })).toMatchObject({ field: "code", existingId: "d2" });
  });
  it("allows fresh values and (no self) is not a conflict for other colleges' data", () => {
    expect(findDepartmentConflict(depts, { name: "Civil Engineering", code: "CIV" })).toBeNull();
    expect(findDepartmentConflict([], { name: "Information Technology", code: "IT" })).toBeNull();
  });
  it("allows renames: own value, case-only change, valid new name; blocks another's", () => {
    expect(findDepartmentConflict(depts, { name: "Information Technology" }, "d2")).toBeNull();
    expect(findDepartmentConflict(depts, { name: "INFORMATION TECHNOLOGY", code: "it" }, "d2")).toBeNull();
    expect(findDepartmentConflict(depts, { name: "Information Systems" }, "d2")).toBeNull();
    expect(findDepartmentConflict(depts, { name: "Computer Science and Engineering" }, "d2")).toMatchObject({ field: "name", existingId: "d1" });
    expect(findDepartmentConflict(depts, { code: "ece" }, "d2")).toMatchObject({ field: "code", existingId: "d3" });
  });
  it("lets a department use the same text as its own name and code", () => {
    expect(findDepartmentConflict(depts, { name: "IT2", code: "IT2" }, "d2")).toBeNull();
  });
});
