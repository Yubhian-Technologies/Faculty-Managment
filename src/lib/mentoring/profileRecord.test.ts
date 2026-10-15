import { describe, expect, it } from "vitest";
import { buildRecordProfile, categoryOf, cleanProfileOverrides } from "./profileRecord";

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
    expect(p.qualifying.map((q) => q.exam)).toEqual(["Class X", "Class XII", "Diploma"]);
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
  it("validates phones, emails and landlines", () => {
    expect(cleanProfileOverrides(student, {}, { motherContactNo: "12345" }).ok).toBe(false);
    expect(cleanProfileOverrides(student, {}, { motherContactNo: "+91 98765 43299" })).toEqual({ ok: true, values: { motherContactNo: "9876543299" } });
    expect(cleanProfileOverrides(student, {}, { motherEmail: "nope" }).ok).toBe(false);
    expect(cleanProfileOverrides(student, {}, { motherLandline: "abc" }).ok).toBe(false);
  });
  it("takes a mentor's entry back when sent blank, and skips unchanged ones", () => {
    expect(cleanProfileOverrides(student, { motherName: "P. Lakshmi" }, { motherName: "" })).toEqual({ ok: true, values: { motherName: "" } });
    expect(cleanProfileOverrides(student, { motherName: "P. Lakshmi" }, { motherName: "P. Lakshmi" })).toEqual({ ok: true, values: {} });
  });
  it("lets the mentor set the category only when the caste cannot give it", () => {
    expect(cleanProfileOverrides({ caste: "OTHER" }, {}, { category: "sc" })).toEqual({ ok: true, values: { category: "SC" } });
    expect(cleanProfileOverrides({ caste: "OTHER" }, {}, { category: "General" }).ok).toBe(false);
    expect(cleanProfileOverrides({ caste: "OC" }, {}, { category: "SC" })).toMatchObject({ ok: false, status: 409 });
  });
});
