import { describe, expect, it } from "vitest";
import {
  BULK_UPDATE_FIELDS, bulkUpdatesOf, classifyBulkUpdate, classifyRowAgainstStudent, expandScientific, normalizeBulkCell, normalizeBulkDate,
  summarizeBulkUpdate, type BulkStudent, type BulkUpdateRow,
} from "./bulkUpdate";
import { parseBulkUpdateRequest } from "./bulkUpdateRows";
import { buildStudentSelfUpdate } from "./selfEdit";

const stu = (id: string, data: Record<string, unknown>): BulkStudent => ({ id, data: { name: id.toUpperCase(), rollNumber: "", ...data } });
const row = (rowNumber: number, mobile: string, values: Record<string, string>): BulkUpdateRow => ({ rowNumber, mobile, values });
const index = (...students: BulkStudent[]) => {
  const m = new Map<string, BulkStudent[]>();
  for (const s of students) m.set(String(s.data.mobileNo), [...(m.get(String(s.data.mobileNo)) ?? []), s]);
  return m;
};
const run = (rows: BulkUpdateRow[], students: BulkStudent[], fields: string[], fillOnly = false, other?: Set<string>) =>
  classifyBulkUpdate({ rows, studentsByMobile: index(...students), fields, fillOnly, otherCollegeMobiles: other });

describe("allow-list", () => {
  it("never offers the key, Roll No or the identity / academic placement fields", () => {
    for (const k of ["mobileNo", "rollNumber", "name", "department", "year", "course", "section", "status", "secondaryDepartment", "studentType"]) {
      expect(BULK_UPDATE_FIELDS).not.toContain(k);
    }
    for (const k of ["email", "fatherName", "bankAccountNo", "caste", "dateOfJoining", "remarks"]) expect(BULK_UPDATE_FIELDS).toContain(k);
  });
  it("the server envelope rejects any field outside it", () => {
    const bad = parseBulkUpdateRequest({ fields: ["email", "rollNumber"], rows: [{ rowNumber: 2, mobile: "9876543210", values: {} }] }, 100);
    expect(bad).toEqual({ error: expect.stringContaining("rollNumber") });
    const ok = parseBulkUpdateRequest({ fields: ["email"], rows: [{ rowNumber: 2, mobile: "9876543210", values: { email: "a@b.co" } }] }, 100);
    expect("rows" in ok && ok.rows[0].values).toEqual({ email: "a@b.co" });
  });
  it("rejects a value for a field that wasn't chosen, and too many rows", () => {
    expect(parseBulkUpdateRequest({ fields: ["email"], rows: [{ rowNumber: 2, mobile: "9876543210", values: { fatherName: "X" } }] }, 100)).toHaveProperty("error");
    expect(parseBulkUpdateRequest({ fields: ["email"], rows: Array.from({ length: 3 }, (_, i) => ({ rowNumber: i + 2, mobile: "1", values: {} })) }, 2)).toHaveProperty("error");
  });
});

describe("per-field rule: fill / same / overwrite, blank never clears", () => {
  const s = stu("s1", { mobileNo: "9876543210", fatherName: "RAMU", email: "old@x.test" });

  it("fills a blank field", () => {
    const [r] = run([row(2, "9876543210", { motherName: "SITA" })], [s], ["motherName"]);
    expect(r.outcome).toBe("WILL_UPDATE");
    expect(r.changes).toMatchObject([{ key: "motherName", mode: "FILL", before: "", after: "SITA" }]);
  });
  it("leaves a field alone when the value is the same", () => {
    const [r] = run([row(2, "9876543210", { fatherName: "RAMU" })], [s], ["fatherName"]);
    expect(r.outcome).toBe("NO_CHANGE");
    expect(r.sameCount).toBe(1);
    expect(r.changes).toEqual([]);
  });
  it("overwrites a different value and shows old -> new", () => {
    const [r] = run([row(2, "9876543210", { fatherName: "RAMAIAH" })], [s], ["fatherName"]);
    expect(r.outcome).toBe("WILL_UPDATE");
    expect(r.changes).toMatchObject([{ mode: "OVERWRITE", before: "RAMU", after: "RAMAIAH", beforeValue: "RAMU", afterValue: "RAMAIAH" }]);
  });
  it("a blank cell never changes or clears anything", () => {
    const [r] = run([row(2, "9876543210", { fatherName: "", email: "   " })], [s], ["fatherName", "email"]);
    expect(r.outcome).toBe("NO_CHANGE");
    expect(r.changes).toEqual([]);
  });
  it("mixed row: only differing fields are written", () => {
    const [r] = run([row(2, "9876543210", { fatherName: "RAMU", email: "new@x.test", motherName: "SITA" })], [s], ["fatherName", "email", "motherName"]);
    expect(r.changes.map((c) => c.key).sort()).toEqual(["email", "motherName"]);
    expect(r.sameCount).toBe(1);
    expect(bulkUpdatesOf(r.changes)).toEqual({ email: "new@x.test", motherName: "SITA" });
  });
  it("fill-blanks-only holds overwrites back but still fills blanks", () => {
    const [r] = run([row(2, "9876543210", { fatherName: "RAMAIAH", motherName: "SITA" })], [s], ["fatherName", "motherName"], true);
    expect(r.outcome).toBe("WILL_UPDATE");
    expect(r.changes.map((c) => c.key)).toEqual(["motherName"]);
    expect(r.held.map((c) => c.key)).toEqual(["fatherName"]);
  });
  it("fill-blanks-only with only overwrites = no change, with the reason", () => {
    const [r] = run([row(2, "9876543210", { fatherName: "RAMAIAH" })], [s], ["fatherName"], true);
    expect(r.outcome).toBe("NO_CHANGE");
    expect(r.message).toContain("kept");
  });
  it("a re-run after applying is a no-op (idempotent)", () => {
    const after = stu("s1", { ...s.data, fatherName: "RAMAIAH" });
    const [r] = run([row(2, "9876543210", { fatherName: "RAMAIAH" })], [after], ["fatherName"]);
    expect(r.outcome).toBe("NO_CHANGE");
  });
  it("false and 0 are real values, not blanks", () => {
    const withFalse = stu("s2", { mobileNo: "9876543211", hosteller: false });
    const [same] = run([row(2, "9876543211", { hosteller: "No" })], [withFalse], ["hosteller"]);
    expect(same.outcome).toBe("NO_CHANGE");
    const [over] = run([row(2, "9876543211", { hosteller: "Yes" })], [withFalse], ["hosteller"]);
    expect(over.changes).toMatchObject([{ mode: "OVERWRITE", before: "No", after: "Yes" }]);
  });
  it("same value in a different spelling is left alone (phone, email case, Aadhar spaces, date format)", () => {
    const x = stu("s3", { mobileNo: "9876543212", fatherContactNo: "98765 43210", email: "A@X.TEST", aadharNo: "1234 5678 9012", dateOfBirth: "12/05/2004" });
    const [r] = run(
      [row(2, "9876543212", { fatherContactNo: "+91 9876543210", email: "a@x.test", aadharNo: "123456789012", dateOfBirth: "2004-05-12" })],
      [x], ["fatherContactNo", "email", "aadharNo", "dateOfBirth"]
    );
    expect(r.outcome).toBe("NO_CHANGE");
    expect(r.sameCount).toBe(4);
  });
});

describe("matching", () => {
  const a = stu("a", { mobileNo: "9876543210" });
  it("no student / another college / bad mobile / shared mobile / duplicate in file", () => {
    const rows = [
      row(2, "9000000001", { email: "a@b.co" }),
      row(3, "9000000002", { email: "a@b.co" }),
      row(4, "12345", { email: "a@b.co" }),
      row(5, "9111111111", { email: "a@b.co" }),
      row(6, "9876543210", { email: "a@b.co" }),
      row(7, "98765 43210", { email: "c@d.co" }),
    ];
    const res = classifyBulkUpdate({
      rows, fields: ["email"], fillOnly: false, otherCollegeMobiles: new Set(["9000000002"]),
      studentsByMobile: new Map([["9876543210", [a]], ["9111111111", [stu("x", { mobileNo: "9111111111" }), stu("y", { mobileNo: "9111111111" })]]]),
    });
    expect(res.map((r) => r.outcome)).toEqual(["NO_MATCH", "NO_MATCH", "BAD_MOBILE", "MOBILE_SHARED", "DUPLICATE_IN_FILE", "DUPLICATE_IN_FILE"]);
    expect(res[1].message).toContain("another college");
    expect(res.every((r) => r.changes.length === 0)).toBe(true);
  });
  it("matches by the normalised number (+91 / spaces)", () => {
    const [r] = run([row(2, "+91 98765 43210", { email: "n@x.co" })], [a], ["email"]);
    expect(r.outcome).toBe("WILL_UPDATE");
    expect(r.studentId).toBe("a");
  });
  it("summarises", () => {
    const res = run([row(2, "9876543210", { email: "n@x.co" }), row(3, "9000000009", { email: "n@x.co" })], [a], ["email"]);
    expect(summarizeBulkUpdate(res)).toMatchObject({ WILL_UPDATE: 1, NO_MATCH: 1 });
  });
});

describe("one bad cell skips the whole student", () => {
  it("BAD_VALUE, nothing applied, every problem named", () => {
    const s = stu("s1", { mobileNo: "9876543210" });
    const [r] = run([row(2, "9876543210", { email: "not-an-email", fatherName: "OK", ifscCode: "bad" })], [s], ["email", "fatherName", "ifscCode"]);
    expect(r.outcome).toBe("BAD_VALUE");
    expect(r.changes).toEqual([]);
    expect(r.message).toContain("Email");
    expect(r.message).toContain("IFSC");
  });
});

describe("cell validation", () => {
  const ok = (key: string, v: string) => { const r = normalizeBulkCell(key, v); return r.ok ? r.value : `ERR:${r.error}`; };
  it("normalises like the self-edit / Office rules", () => {
    expect(ok("email", " A@X.Co ")).toBe("a@x.co");
    expect(ok("ifscCode", "sbin0001234")).toBe("SBIN0001234");
    expect(ok("bankAccountNo", "1234 5678-9012")).toBe("123456789012");
    expect(ok("fatherContactNo", "+91 98765 43210")).toBe("9876543210");
    expect(ok("aadharNo", "1234 5678 9012")).toBe("123456789012");
    expect(ok("gender", "female")).toBe("Female");
    expect(ok("caste", "bc-a")).toBe("BC-A");
    expect(ok("handicappedType", "h")).toBe("H");
    expect(ok("scholarship", "y")).toBe(true);
    expect(ok("distanceFromResidenceKm", "5.5")).toBe(5.5);
    expect(ok("dateOfBirth", "12-05-2004")).toBe("2004-05-12");
  });
  it("rejects bad values", () => {
    for (const [k, v] of [
      ["fatherContactNo", "12345"], ["fatherContactNo", "5876543210"], ["email", "nope"], ["ifscCode", "SBIN123"], ["bankAccountNo", "12345"],
      ["aadharNo", "1234"], ["gender", "x"], ["caste", "ZZ"], ["handicappedType", "Q"], ["hosteller", "maybe"],
      ["distanceFromResidenceKm", "-1"], ["distanceFromResidenceKm", "9000"], ["dateOfBirth", "31-02-2004"], ["dateOfBirth", "soon"], ["landLineNo", "ab"],
    ] as const) expect(ok(k, v), `${k}=${v}`).toMatch(/^ERR:/);
  });
  it("catches Excel's scientific-notation damage on long numbers", () => {
    expect(ok("bankAccountNo", "1.23457E+15")).toMatch(/Text/);
    expect(ok("aadharNo", "6.6806E+11")).toMatch(/Text/);
  });
  it("expands scientific notation only when it is exact - never invents digits", () => {
    expect(expandScientific("1.23456789012E+11")).toBe("123456789012");
    expect(ok("aadharNo", "1.23456789012E+11")).toBe("123456789012");
    expect(ok("bankAccountNo", "1.234567890123456E+15")).toBe("1234567890123456");
    expect(expandScientific("6.6806E+11")).toBeNull(); // trailing digits already lost in the file
    expect(expandScientific("6.6806E+11")).not.toBe("668060000000");
  });
  it("a damaged cell skips only that field - the student's other fields still apply, with a warning", () => {
    const s = stu("s1", { mobileNo: "9876543210" });
    const [r] = run([row(2, "9876543210", { aadharNo: "6.6806E+11", email: "n@x.co" })], [s], ["aadharNo", "email"]);
    expect(r.outcome).toBe("WILL_UPDATE");
    expect(bulkUpdatesOf(r.changes)).toEqual({ email: "n@x.co" });
    expect(r.warnings.join(" ")).toContain("Aadhar");
    const [only] = run([row(2, "9876543210", { aadharNo: "6.6806E+11" })], [s], ["aadharNo"]);
    expect(only.outcome).toBe("NO_CHANGE");
    expect(only.changes).toEqual([]);
    expect(only.warnings.length).toBe(1);
  });
  it("length caps", () => {
    expect(ok("fatherName", "x".repeat(201))).toMatch(/too long/);
    expect(ok("temporaryAddress", "x".repeat(500))).toBe("x".repeat(500));
    expect(ok("temporaryAddress", "x".repeat(501))).toMatch(/too long/);
  });
  it("dates", () => {
    expect(normalizeBulkDate("2004-5-2")).toBe("2004-05-02");
    expect(normalizeBulkDate("02/05/2004")).toBe("2004-05-02");
    expect(normalizeBulkDate("2004-13-01")).toBeNull();
    expect(normalizeBulkDate("1850-01-01")).toBeNull();
  });
});

describe("parity with the student self-edit rules (so the two cannot drift)", () => {
  const cases: [string, string][] = [
    ["email", "A@X.CO"], ["email", "bad"], ["ifscCode", "sbin0001234"], ["ifscCode", "bad"], ["bankAccountNo", "1234 5678 9012"], ["bankAccountNo", "12"],
    ["fatherContactNo", "98765 43210"], ["fatherContactNo", "12345"], ["landLineNo", "040-123456"], ["landLineNo", "x"],
    ["distanceFromResidenceKm", "12"], ["distanceFromResidenceKm", "-4"], ["hosteller", "yes"], ["handicappedType", "v"], ["handicappedType", "z"],
  ];
  for (const [key, value] of cases) {
    it(`${key} = ${JSON.stringify(value)}`, () => {
      const self = buildStudentSelfUpdate({ mobileNo: "9876543210", rollNumber: "R1" }, { [key]: value });
      const mine = normalizeBulkCell(key, value);
      expect(mine.ok, "same accept/reject decision").toBe(self.ok);
      if (self.ok && mine.ok) expect(self.updates[key]).toEqual(mine.value);
    });
  }
});

describe("never erases to keep things tidy (unlike self-edit)", () => {
  it("setting Physically Handicapped = No keeps the Handicapped Type and only warns", () => {
    const s = stu("s1", { mobileNo: "9876543210", physicallyHandicapped: true, handicappedType: "H" });
    const [r] = run([row(2, "9876543210", { physicallyHandicapped: "No" })], [s], ["physicallyHandicapped"]);
    expect(r.outcome).toBe("WILL_UPDATE");
    expect(bulkUpdatesOf(r.changes)).toEqual({ physicallyHandicapped: false });
    expect(r.warnings.join(" ")).toContain("Handicapped Type");
  });
  it("'same as temporary' = Yes does not overwrite a different Permanent Address; it warns", () => {
    const s = stu("s1", { mobileNo: "9876543210", temporaryAddress: "A", permanentAddress: "B" });
    const [r] = run([row(2, "9876543210", { permanentAddressSameAsTemporary: "Yes" })], [s], ["permanentAddressSameAsTemporary"]);
    expect(bulkUpdatesOf(r.changes)).toEqual({ permanentAddressSameAsTemporary: true });
    expect(r.warnings.join(" ")).toContain("differ");
  });
});

describe("classifyRowAgainstStudent is what apply re-runs on fresh data", () => {
  it("a value changed after the preview is judged against the current value", () => {
    const r = row(2, "9876543210", { fatherName: "RAMAIAH" });
    const before = classifyRowAgainstStudent(r, stu("s", { fatherName: "RAMU" }), { fields: ["fatherName"], fillOnly: false });
    expect(before.outcome).toBe("WILL_UPDATE");
    const afterEdit = classifyRowAgainstStudent(r, stu("s", { fatherName: "RAMAIAH" }), { fields: ["fatherName"], fillOnly: false });
    expect(afterEdit.outcome).toBe("NO_CHANGE");
  });
});
