import { describe, expect, it } from "vitest";
import { SELF_EDITABLE_STAFF_FIELDS, SELF_LOCKED_STAFF_FIELDS, supportingStaffPersonalUpdate } from "./personalUpdate";

describe("supportingStaffPersonalUpdate", () => {
  it("keeps the personal fields the admin screen used to drop silently", () => {
    const u = supportingStaffPersonalUpdate({
      motherTongue: "Telugu", languagesKnown: ["Telugu"], height: "170", weightKg: 70, pfNumber: "PF1", uanNumber: "U1", esiNumber: "E1",
    });
    expect(u).toMatchObject({ motherTongue: "Telugu", languagesKnown: ["Telugu"], height: "170", weightKg: 70, pfNumber: "PF1", uanNumber: "U1", esiNumber: "E1" });
  });

  it("never carries ratification or differently-abled fields (they are Faculty-only)", () => {
    const u = supportingStaffPersonalUpdate({
      ratificationStatus: "RATIFIED", ratificationProceedingsNumber: "P1", ratificationDate: "2020-01-01", differentlyAbled: true, differentlyAbledDetails: "x",
    } as never);
    for (const k of ["ratificationStatus", "ratificationProceedingsNumber", "ratificationDate", "ratifications", "differentlyAbled", "differentlyAbledDetails"]) {
      expect(k in u).toBe(false);
    }
  });

  it("writes nothing for fields the body does not mention", () => {
    expect(supportingStaffPersonalUpdate({ fatherName: "F" })).toEqual({ fatherName: "F" });
  });
});

describe("self-service field lists", () => {
  it("editable and locked fields never overlap", () => {
    const locked = new Set<string>(SELF_LOCKED_STAFF_FIELDS);
    expect(SELF_EDITABLE_STAFF_FIELDS.filter((f) => locked.has(f))).toEqual([]);
  });

  it("Employee ID, College Email, Designation, Department, Category, Joining Date and Status are locked", () => {
    for (const f of ["employeeId", "collegeEmail", "designation", "department", "staffCategory", "joiningDate", "status"]) {
      expect(SELF_LOCKED_STAFF_FIELDS).toContain(f);
    }
  });
});
