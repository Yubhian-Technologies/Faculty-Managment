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
  it("offers only the booklet's own details to the mentor - never what the student's record holds", () => {
    // not on the student's record at all (booklet only): the mentor fills them
    expect(field(p, "father", "fatherEmail")).toMatchObject({ value: "", source: null, editable: true });
    expect(field(p, "hostel", "hostelName").editable).toBe(true);
    // on the student's record (even when blank there): read-only here, filled on the record itself
    expect(field(p, "mother", "motherName")).toMatchObject({ value: "", source: null, editable: false });
    expect(field(p, "student", "dateOfBirth").editable).toBe(false);
    const noName = buildRecordProfile({});
    expect(field(noName, "student", "name").editable).toBe(false);
    expect(field(noName, "student", "rollNumber").editable).toBe(false);
  });
  it("reads qualifying exams from the student's previous education", () => {
    expect(p.qualifying.map((q) => q.exam)).toEqual(["Class X (SSC / 10th)", "Class XII (Intermediate)", "Diploma (Polytechnic)"]);
    expect(p.qualifying[0].institution).toMatchObject({ value: "Z.P. High School", source: "STUDENT" });
    expect(p.qualifying[0].percentage.value).toBe("95");
    expect(p.qualifying[1].institution).toMatchObject({ value: "", editable: false });
  });
  it("never lets a mentor's or HOD's entry replace what the record holds, even an older one", () => {
    const old = buildRecordProfile(student, { motherName: "P. Lakshmi", fatherName: "Someone else", hod_fatherName: "Other" });
    expect(field(old, "father", "fatherName")).toMatchObject({ value: "P. Ramesh", source: "STUDENT", editable: false });
    // an older entry stays visible only while the record has nothing, and cannot be edited
    expect(field(old, "mother", "motherName")).toMatchObject({ value: "P. Lakshmi", source: "MENTOR", editable: false });
  });
  it("counts only what the mentor can still fill", () => {
    const more = buildRecordProfile(student, { fatherEmail: "r@x.com" });
    expect(more.missingCount).toBe(p.missingCount - 1);
    expect(p.missingCount).toBeGreaterThan(0);
    expect(buildRecordProfile({}).groups.flatMap((g) => g.fields).filter((x) => x.editable && !x.value).every((x) => ["fatherEmail", "motherEmail", "motherAddress", "category", "previousQualification", "entranceHallTicket", "entranceYear"].includes(x.key) || x.key.startsWith("hostel"))).toBe(true);
  });
});

describe("cleanProfileOverrides", () => {
  it("accepts the booklet-only details and cleans them", () => {
    expect(cleanProfileOverrides(student, {}, { motherEmail: " Lakshmi@Gmail.com ", fatherEmail: "Ramesh@Gmail.com" }))
      .toEqual({ ok: true, values: { motherEmail: "lakshmi@gmail.com", fatherEmail: "ramesh@gmail.com" } });
  });
  it("refuses any detail the student's own record has a place for, filled or blank", () => {
    expect(cleanProfileOverrides(student, {}, { fatherName: "Other" })).toMatchObject({ ok: false, status: 409 });
    expect(cleanProfileOverrides(student, {}, { motherName: "P. Lakshmi" })).toMatchObject({ ok: false, status: 409 });
    expect(cleanProfileOverrides(student, {}, { interYearOfPass: "2022" }, true)).toMatchObject({ ok: false, status: 409 });
    expect(cleanProfileOverrides(student, {}, { fatherName: "Other" }, true)).toMatchObject({ ok: false, status: 409 });
    expect(cleanProfileOverrides({}, {}, { hosteller: "yes" })).toMatchObject({ ok: false, status: 409 });
    expect(cleanProfileOverrides({}, {}, { entranceType: "EAPCET" })).toMatchObject({ ok: false, status: 409 });
  });
  it("refuses identity fields and unknown keys", () => {
    expect(cleanProfileOverrides(student, {}, { name: "X" })).toMatchObject({ ok: false, status: 400 });
    expect(cleanProfileOverrides(student, {}, { aadharNo: "1" })).toMatchObject({ ok: false, status: 400 });
  });
  it("validates emails", () => {
    expect(cleanProfileOverrides(student, {}, { motherEmail: "nope" }).ok).toBe(false);
  });
  it("takes a mentor's entry back when sent blank, and skips unchanged ones", () => {
    expect(cleanProfileOverrides(student, { motherEmail: "a@b.co" }, { motherEmail: "" })).toEqual({ ok: true, values: { motherEmail: "" } });
    expect(cleanProfileOverrides(student, { motherEmail: "a@b.co" }, { motherEmail: "a@b.co" })).toEqual({ ok: true, values: {} });
  });
  it("takes a 4-digit entrance year", () => {
    expect(cleanProfileOverrides({}, {}, { entranceYear: "2023" })).toEqual({ ok: true, values: { entranceYear: "2023" } });
    expect(cleanProfileOverrides({}, {}, { entranceYear: "23" }).ok).toBe(false);
  });
  it("works out Intermediate or Diploma from the record, and does not guess when it cannot", () => {
    expect(qualificationOf({ studentType: "Lateral" })).toBe("Diploma (Polytechnic)");
    expect(qualificationOf({ diplomaInstitution: "Govt Polytechnic" })).toBe("Diploma (Polytechnic)");
    expect(qualificationOf({ entranceType: "ECET" })).toBe("Diploma (Polytechnic)");
    expect(qualificationOf({ interBoard: "BIE" })).toBe("Intermediate (Class XII)");
    expect(qualificationOf({ entranceType: "EAMCET" })).toBe("Intermediate (Class XII)");
    expect(qualificationOf({})).toBe("");
    expect(cleanProfileOverrides({}, {}, { previousQualification: "diploma (polytechnic)" })).toEqual({ ok: true, values: { previousQualification: "Diploma (Polytechnic)" } });
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
    expect(cleanProfileOverrides({ hosteller: "Yes" }, {}, { hostelName: "Block A" })).toMatchObject({ ok: false, status: 400 });
    expect(cleanProfileOverrides({ hosteller: "Yes" }, {}, { hostelName: "Block A", hostelRoom: "214" }))
      .toEqual({ ok: true, values: { hostelName: "Block A", hostelRoom: "214" } });
    expect(cleanProfileOverrides({ hosteller: true }, {}, { hostelName: "Block A" })).toMatchObject({ ok: false, status: 400 });
    expect(cleanProfileOverrides({ hosteller: false }, {}, { hostelName: "Block A" }).ok).toBe(true);
    expect(cleanProfileOverrides({ hosteller: true }, {}, { motherEmail: "a@b.co" }).ok).toBe(true);
  });
  it("lets the mentor set the category only when the caste cannot give it", () => {
    expect(cleanProfileOverrides({ caste: "OTHER" }, {}, { category: "sc" })).toEqual({ ok: true, values: { category: "SC" } });
    expect(cleanProfileOverrides({ caste: "OTHER" }, {}, { category: "General" }).ok).toBe(false);
    expect(cleanProfileOverrides({ caste: "OC" }, {}, { category: "SC" })).toMatchObject({ ok: false, status: 409 });
  });
});
