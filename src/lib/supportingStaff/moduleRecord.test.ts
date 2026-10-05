import { describe, expect, it } from "vitest";
import { supportingStaffIdentityPatchBody, supportingStaffModulePatchBody, supportingStaffRecordFromDoc } from "@/lib/supportingStaff/moduleRecord";

// The tabbed Edit page and the per-section page share these - so what a save sends must be exactly what each always sent.

const form = {
  apaarFacultyId: "123456789012", mobileNo: "9876543210", collegeEmail: "a@b.in", designation: "Lab assistance",
  otherDesignationTitle: "", department: "BASIC SCIENCE", highestQualification: "ITI", status: "ACTIVE", joiningDate: "2018-02-01",
};
const base = { form, legalName: "SURESH", email: "p@x.in", employeeId: "EMP-1", extraPhones: [] as { label?: string; number: string }[], photoUrl: undefined as string | undefined };

describe("identity save body", () => {
  it("HOD (locked): the department is NEVER sent, everything else is", () => {
    const b = supportingStaffIdentityPatchBody({ ...base, departmentMode: "locked" });
    expect(b).not.toHaveProperty("department");
    const { department: _d, ...withoutDept } = form;
    void _d;
    expect(b).toMatchObject({ ...withoutDept, legalName: "SURESH", email: "p@x.in", employeeId: "EMP-1", additionalPhoneNumbers: [] });
    expect(b).not.toHaveProperty("profilePhotoUrl");
  });
  it("College Office (select) and Library send the department as loaded / chosen", () => {
    expect(supportingStaffIdentityPatchBody({ ...base, departmentMode: "select" })).toMatchObject({ department: "BASIC SCIENCE" });
    expect(supportingStaffIdentityPatchBody({ ...base, form: { ...form, department: "Library" }, departmentMode: "library" })).toMatchObject({ department: "Library" });
    expect(supportingStaffIdentityPatchBody({ ...base, form: { ...form, department: "" }, departmentMode: "select" })).toHaveProperty("department", "");   // 'centrally managed'
  });
  it("blank extra phones are dropped, filled ones kept with their label", () => {
    const b = supportingStaffIdentityPatchBody({ ...base, extraPhones: [{ label: "W", number: " 98 " }, { label: "", number: "  " }], departmentMode: "select" });
    expect(b.additionalPhoneNumbers).toEqual([{ label: "W", number: " 98 " }]);
  });
  it("photo: untouched = not sent, removed = sent as empty string, set = sent", () => {
    expect(supportingStaffIdentityPatchBody({ ...base, departmentMode: "select" })).not.toHaveProperty("profilePhotoUrl");
    expect(supportingStaffIdentityPatchBody({ ...base, photoUrl: "", departmentMode: "select" })).toHaveProperty("profilePhotoUrl", "");
    expect(supportingStaffIdentityPatchBody({ ...base, photoUrl: "u", departmentMode: "select" })).toHaveProperty("profilePhotoUrl", "u");
  });
});

describe("section save body", () => {
  const record = supportingStaffRecordFromDoc({ legalName: "SURESH", gender: "Male", panNo: "ABCDE1234F", supportingStaffProfile: { x: 1 } });
  it("personal sends the personal fields (including the one Full Name), never the profile object", () => {
    const b = supportingStaffModulePatchBody("personal", record);
    expect(b).toMatchObject({ legalName: "SURESH", gender: "Male", panNo: "ABCDE1234F" });
    expect(b).not.toHaveProperty("supportingStaffProfile");
    expect(Object.keys(b)).toHaveLength(38);
  });
  it("every other section sends the WHOLE profile object (the API replaces it wholesale)", () => {
    for (const k of ["qualifications", "responsibilities", "training", "achievements", "others"] as const) {
      expect(supportingStaffModulePatchBody(k, record)).toEqual({ supportingStaffProfile: { x: 1 } });
    }
  });
});

describe("record from a doc", () => {
  it("blanks become empty strings / defaults, never undefined crashes", () => {
    const r = supportingStaffRecordFromDoc({});
    expect(r).toMatchObject({ legalName: "", gender: "", permanentAddressSameAsTemporary: false, languagesKnown: [], supportingStaffProfile: {} });
  });
});
