import { describe, expect, it } from "vitest";
import { buildRecordProfile, categoryOf, cleanProfileOverrides, coveredRosterKeys, qualificationOf } from "./profileRecord";

const student = {
  name: "P. Sai Kumar", rollNumber: "22A91A0501", mobileNo: "9876543211", caste: "BC-B", subCaste: "Yadava",
  fatherName: "P. Ramesh", fatherContactNo: "9876543210", temporaryAddress: "12-3-45, Vijayawada",
  sscInstitution: "Z.P. High School", sscYearOfPass: "2020", sscPercentage: "95", interInstitution: "",
};

const field = (p: ReturnType<typeof buildRecordProfile>, group: string, key: string) =>
  p.groups.find((g) => g.id === group)!.fields.find((f) => f.key === key)!;

describe("categoryOf", () => {
  it("ticks the booklet's four boxes from the roster caste", () => {
    expect(categoryOf("OC")).toBe("OC");
    expect(categoryOf("BC-B")).toBe("OBC");
    expect(categoryOf("EBC")).toBe("OBC");
    expect(categoryOf("sc")).toBe("SC");
    expect(categoryOf("OTHER")).toBe("");
    expect(categoryOf(undefined)).toBe("");
  });
});

describe("buildRecordProfile", () => {
  const p = buildRecordProfile(student);

  it("shows what the student's record holds, as theirs and not editable", () => {
    expect(field(p, "student", "name")).toMatchObject({ value: "P. Sai Kumar", source: "STUDENT", editable: false });
    expect(field(p, "father", "fatherContactNo")).toMatchObject({ value: "9876543210", source: "STUDENT", editable: false });
    expect(field(p, "student", "category")).toMatchObject({ value: "OBC", source: "DERIVED", editable: false });
  });
  it("falls back to the temporary address for the permanent one", () => {
    expect(field(p, "father", "permanentAddress").value).toBe("12-3-45, Vijayawada");
  });
  it("offers missing details to the mentor, never the student's identity", () => {
    expect(field(p, "mother", "motherName")).toMatchObject({ value: "", source: null, editable: true });
    expect(field(p, "father", "fatherEmail").editable).toBe(true);
    const noName = buildRecordProfile({});
    expect(field(noName, "student", "name").editable).toBe(false);
    expect(field(noName, "student", "rollNumber").editable).toBe(false);
  });
  it("reads qualifying exams from the student's previous education", () => {
    expect(p.qualifying.map((q) => q.exam)).toEqual(["Class X (SSC / 10th)", "Class XII (Intermediate)", "Diploma (Polytechnic)"]);
    expect(p.qualifying[0].institution).toMatchObject({ value: "Z.P. High School", source: "STUDENT" });
    expect(p.qualifying[0].percentage.value).toBe("95");
    expect(p.qualifying[1].institution).toMatchObject({ value: "", editable: true });
  });
  it("lets a mentor's entry stand in only while the student's own value is missing", () => {
    const withOverrides = buildRecordProfile(student, { motherName: "P. Lakshmi", fatherName: "Someone else" });
    expect(field(withOverrides, "mother", "motherName")).toMatchObject({ value: "P. Lakshmi", source: "MENTOR", editable: true });
    expect(field(withOverrides, "father", "fatherName")).toMatchObject({ value: "P. Ramesh", source: "STUDENT" });
  });
  it("counts what is still missing", () => {
    const more = buildRecordProfile(student, { motherName: "P. Lakshmi" });
    expect(more.missingCount).toBe(p.missingCount - 1);
    expect(p.missingCount).toBeGreaterThan(10);
  });
});

describe("cleanProfileOverrides", () => {
  it("accepts a missing detail and cleans it", () => {
    expect(cleanProfileOverrides(student, {}, { motherName: "  P. Lakshmi ", fatherEmail: "Ramesh@Gmail.com" }))
      .toEqual({ ok: true, values: { motherName: "P. Lakshmi", fatherEmail: "ramesh@gmail.com" } });
  });
  it("refuses a detail the student's record already answers", () => {
    const r = cleanProfileOverrides(student, {}, { fatherName: "Other" });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });
  it("refuses identity fields and unknown keys", () => {
    expect(cleanProfileOverrides(student, {}, { name: "X" })).toMatchObject({ ok: false, status: 400 });
    expect(cleanProfileOverrides(student, {}, { aadharNo: "1" })).toMatchObject({ ok: false, status: 400 });
  });
  it("validates phones and emails", () => {
    expect(cleanProfileOverrides(student, {}, { motherContactNo: "12345" }).ok).toBe(false);
    expect(cleanProfileOverrides(student, {}, { motherContactNo: "+91 98765 43299" })).toEqual({ ok: true, values: { motherContactNo: "9876543299" } });
    expect(cleanProfileOverrides(student, {}, { motherEmail: "nope" }).ok).toBe(false);
  });
  it("takes a mentor's entry back when sent blank, and skips unchanged ones", () => {
    expect(cleanProfileOverrides(student, { motherName: "P. Lakshmi" }, { motherName: "" })).toEqual({ ok: true, values: { motherName: "" } });
    expect(cleanProfileOverrides(student, { motherName: "P. Lakshmi" }, { motherName: "P. Lakshmi" })).toEqual({ ok: true, values: {} });
  });
  it("takes a 4-digit year of passing and a 0-100 percentage", () => {
    expect(cleanProfileOverrides(student, {}, { interYearOfPass: "2022" })).toEqual({ ok: true, values: { interYearOfPass: "2022" } });
    expect(cleanProfileOverrides(student, {}, { interYearOfPass: "22" }).ok).toBe(false);
    expect(cleanProfileOverrides(student, {}, { interPercentage: "92.5" }).ok).toBe(true);
    expect(cleanProfileOverrides(student, {}, { interPercentage: "101" }).ok).toBe(false);
    expect(cleanProfileOverrides(student, {}, { interPercentage: "9x" }).ok).toBe(false);
  });
  it("lets only the HOD correct what the student's record holds, shown instead of it", () => {
    expect(cleanProfileOverrides(student, {}, { fatherName: "P. Ramesh Babu" }, true)).toEqual({ ok: true, values: { hod_fatherName: "P. Ramesh Babu" } });
    expect(cleanProfileOverrides(student, {}, { fatherName: "P. Ramesh" }, true)).toEqual({ ok: true, values: {} });
    expect(cleanProfileOverrides(student, {}, { name: "X" }, true).ok).toBe(false);
    expect(cleanProfileOverrides(student, { hod_fatherName: "P. Ramesh Babu" }, { fatherName: "Other" })).toMatchObject({ ok: false, status: 409 });
    const p = buildRecordProfile(student, { hod_fatherName: "P. Ramesh Babu" }, true);
    expect(field(p, "father", "fatherName")).toMatchObject({ value: "P. Ramesh Babu", source: "HOD", editable: true });
    expect(field(buildRecordProfile(student, {}, true), "father", "fatherName")).toMatchObject({ source: "STUDENT", editable: true });
    expect(field(buildRecordProfile(student, {}, false), "father", "fatherName").editable).toBe(false);
  });
  it("asks for an entrance rank (no marks) once EAPCET or ECET is chosen", () => {
    expect(cleanProfileOverrides({}, {}, { entranceType: "eapcet" }).ok).toBe(false);
    expect(cleanProfileOverrides({}, {}, { entranceType: "eapcet", entranceRank: "4521", entranceYear: "2023" }))
      .toEqual({ ok: true, values: { entranceType: "EAPCET", entranceRank: "4521", entranceYear: "2023" } });
    expect(cleanProfileOverrides({}, {}, { entranceType: "JEE", entranceRank: "1" }).ok).toBe(false);
    expect(cleanProfileOverrides({}, {}, { entranceType: "ECET", entranceRank: "12a" }).ok).toBe(false);
    expect(cleanProfileOverrides({ entranceType: "ECET" }, {}, { entranceRank: "902" }).ok).toBe(true);
  });
  it("works out Intermediate or Diploma from the record, and does not guess when it cannot", () => {
    expect(qualificationOf({ studentType: "Lateral" })).toBe("Diploma (Polytechnic)");
    expect(qualificationOf({ diplomaInstitution: "Govt Polytechnic" })).toBe("Diploma (Polytechnic)");
    expect(qualificationOf({ entranceType: "ECET" })).toBe("Diploma (Polytechnic)");
    expect(qualificationOf({ interBoard: "BIE" })).toBe("Intermediate (Class XII)");
    expect(qualificationOf({ entranceType: "EAMCET" })).toBe("Intermediate (Class XII)");
    expect(qualificationOf({})).toBe("");
    expect(cleanProfileOverrides({}, {}, { previousQualification: "diploma (polytechnic)" })).toEqual({ ok: true, values: { previousQualification: "Diploma (Polytechnic)" } });
    expect(cleanProfileOverrides({ studentType: "Lateral" }, {}, { entranceType: "EAPCET", entranceRank: "5" }).ok).toBe(false);
  });
  it("keeps nothing from the old Profile tab out of the page", () => {
    const keys = coveredRosterKeys({ permanentAddress: "A", temporaryAddress: "B" });
    expect(keys.has("temporaryAddress")).toBe(false);
    expect(keys.has("caste")).toBe(false);
    expect(coveredRosterKeys({ temporaryAddress: "B" }).has("temporaryAddress")).toBe(true);
    const p = buildRecordProfile({ caste: "BC-B", guardianName: "Uncle" }, { guardianContact: "9876543210" });
    const rows = p.otherGroups.flatMap((g) => g.rows.map((r) => r.label));
    expect(rows).toContain("Caste");
    expect(p.otherGroups.at(-1)!.rows).toEqual([{ label: "Guardian mobile number", value: "9876543210" }]);
  });
  it("requires hostel name and room for a hosteller, and only when the hostel answers are saved", () => {
    expect(cleanProfileOverrides({}, {}, { hosteller: "yes" })).toMatchObject({ ok: false, status: 400 });
    expect(cleanProfileOverrides({}, {}, { hosteller: "yes", hostelName: "Block A" })).toMatchObject({ ok: false, status: 400 });
    expect(cleanProfileOverrides({}, {}, { hosteller: "yes", hostelName: "Block A", hostelRoom: "214" }))
      .toEqual({ ok: true, values: { hosteller: "Yes", hostelName: "Block A", hostelRoom: "214" } });
    expect(cleanProfileOverrides({ hosteller: true }, {}, { hostelName: "Block A" })).toMatchObject({ ok: false, status: 400 });
    expect(cleanProfileOverrides({ hosteller: false }, {}, { hostelName: "Block A" }).ok).toBe(true);
    expect(cleanProfileOverrides({ hosteller: true }, {}, { motherName: "P. Lakshmi" }).ok).toBe(true);
  });
  it("lets the mentor set the category only when the caste cannot give it", () => {
    expect(cleanProfileOverrides({ caste: "OTHER" }, {}, { category: "sc" })).toEqual({ ok: true, values: { category: "SC" } });
    expect(cleanProfileOverrides({ caste: "OTHER" }, {}, { category: "General" }).ok).toBe(false);
    expect(cleanProfileOverrides({ caste: "OC" }, {}, { category: "SC" })).toMatchObject({ ok: false, status: 409 });
  });
});
