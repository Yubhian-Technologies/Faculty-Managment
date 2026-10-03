import { describe, it, expect } from "vitest";
import {
  FULL_RECORD_ROLES,
  LIBRARY_LIST_FIELDS,
  REDACTED_FOR_DEPARTMENT_ROLES,
  projectStudentForRole,
  projectStudentsForRole,
} from "@/lib/students/listProjection";

const full = () => ({
  id: "s1", name: "Anil", rollNumber: "R1", department: "CSE", secondaryDepartment: "ECE", year: 2, section: "A", status: "REGULAR", course: "BTech", courseId: "c1", accessLevel: "FULL",
  mobileNo: "9999999999", email: "a@x.com", parentMobile: "8888888888", address: "Somewhere", labBatch: "L1", photoUrl: "http://p",
  aadharNo: "1234", rationCardNo: "R", bankAccountNo: "B", bankName: "SBI", ifscCode: "SBIN", caste: "x", subCaste: "y", religion: "z", scholarship: "s",
  jeeRank: 1, jeePercentage: 99, entranceType: "e", entranceRank: 2, physicallyHandicapped: true, handicappedType: "h", identificationMarks: "m",
  studiedOutsideAP: true, studiedOutsideAPDetails: "d", familyIdLinkedOtherState: true, familyIdLinkedOtherStateDetails: "f",
});

describe("projectStudentForRole (S9: list PII minimisation)", () => {
  it.each([...FULL_RECORD_ROLES])("%s keeps the full record (they own admission data)", (role) => {
    expect(projectStudentForRole(role, full())).toEqual(full());
  });

  it("HOD and faculty lose every national-ID, bank, caste/religion, disability and admission-score field but keep what their screens use", () => {
    for (const role of ["HOD", "PANEL_MEMBER"]) {
      const out = projectStudentForRole(role, full()) as Record<string, unknown>;
      for (const k of REDACTED_FOR_DEPARTMENT_ROLES) expect(out).not.toHaveProperty(k);
      expect(out).toMatchObject({ id: "s1", name: "Anil", rollNumber: "R1", mobileNo: "9999999999", parentMobile: "8888888888", labBatch: "L1", section: "A", photoUrl: "http://p" });
    }
  });

  it("Library gets an identity-only record", () => {
    const out = projectStudentForRole("LIBRARY", full()) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual([...LIBRARY_LIST_FIELDS].sort());
    expect(out).not.toHaveProperty("mobileNo");
    expect(out).not.toHaveProperty("aadharNo");
  });

  it("an unknown role is treated like the department roles (fail towards less data, never the full record)", () => {
    const out = projectStudentForRole("SOMETHING_NEW", full()) as Record<string, unknown>;
    expect(out).not.toHaveProperty("aadharNo");
  });

  it("never mutates its input", () => {
    const original = full();
    projectStudentForRole("HOD", original);
    projectStudentForRole("LIBRARY", original);
    expect(original).toEqual(full());
  });

  it("a Library row only carries fields the student actually has (no undefined keys)", () => {
    const out = projectStudentForRole("LIBRARY", { id: "s", name: "N" }) as Record<string, unknown>;
    expect(out).toEqual({ id: "s", name: "N" });
  });

  it("projectStudentsForRole maps every row, and returns the same array for the office tier", () => {
    const rows = [full(), full()];
    expect(projectStudentsForRole("COLLEGE_OFFICE", rows)).toBe(rows);
    const lib = projectStudentsForRole("LIBRARY", rows);
    expect(lib).toHaveLength(2);
    expect(lib.every((r) => !("aadharNo" in r))).toBe(true);
  });
});
