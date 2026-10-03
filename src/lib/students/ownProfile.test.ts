import { describe, it, expect } from "vitest";
import { buildOwnProfileGroups } from "./ownProfile";
import { slotVisibleToStudent } from "./ownContext";
import type { StudentRecord } from "@/types";

const student = {
  name: "A. Deepika",
  rollNumber: "26A91A4473",
  gender: "Female",
  fatherName: "A. Rao",
  aadharNo: "123456789012",
  bankAccountNo: "9876543210",
  rationCardNo: "RC12",
  ifscCode: "SBIN0001234",
  remarks: "Staff only: counselling note",
  physicallyHandicapped: true,
  handicappedType: "H",
  // login linkage / audit fields that must never surface
  uid: "uid-123",
  loginEmail: "26a91a4473@students.internal",
  loginCreatedBy: "office-uid",
  rollNumberUpper: "26A91A4473",
} as unknown as Partial<StudentRecord>;

describe("own profile", () => {
  const groups = buildOwnProfileGroups(student);
  const all = groups.flatMap((g) => g.rows);
  const text = JSON.stringify(groups);

  it("shows the student's own identity and bank numbers exactly as held", () => {
    expect(all.find((r) => r.label.startsWith("Aadhar"))?.value).toBe("123456789012");
    expect(all.find((r) => r.label.includes("Bank A/C"))?.value).toBe("9876543210");
    expect(all.find((r) => r.label.startsWith("Ration"))?.value).toBe("RC12");
    expect(text).not.toContain("XXXX");
  });

  it("never includes staff remarks or login linkage", () => {
    expect(text).not.toContain("counselling note");
    for (const leak of ["uid-123", "students.internal", "office-uid", "loginEmail"]) expect(text).not.toContain(leak);
  });

  it("keeps ordinary details, expands the handicapped code and drops empty groups", () => {
    expect(all.find((r) => r.label === "Gender")?.value).toBe("Female");
    expect(all.find((r) => r.label === "Father Name")?.value).toBe("A. Rao");
    expect(all.find((r) => r.label.startsWith("If Yes (Handicapped)"))?.value).toBe("Hearing");
    expect(groups.every((g) => g.rows.length > 0)).toBe(true);
    expect(groups.map((g) => g.title)).not.toContain("Additional Information"); // only had remarks
  });
});

describe("slotVisibleToStudent", () => {
  it("shows every un-split period", () => {
    expect(slotVisibleToStudent({}, "Batch 1")).toBe(true);
  });
  it("shows only the student's own lab batch (case/space-insensitive)", () => {
    expect(slotVisibleToStudent({ labBatch: "Batch 1" }, " batch 1 ")).toBe(true);
    expect(slotVisibleToStudent({ labBatch: "Batch 2" }, "Batch 1")).toBe(false);
  });
  it("a student with no batch yet sees all batches rather than none", () => {
    expect(slotVisibleToStudent({ labBatch: "Batch 2" }, undefined)).toBe(true);
  });
});
