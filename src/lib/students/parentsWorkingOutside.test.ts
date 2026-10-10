import { describe, it, expect } from "vitest";
import {
  ROSTER_FIELDS, ROSTER_DETAIL_GROUPS, ROSTER_SAMPLE_ROWS, normalizeRosterDetails, rosterFormToPayload, rosterFieldDisplay, rosterFieldFormValue,
} from "@/lib/students/rosterFields";
import { buildStudentDoc, type StudentImportRow } from "@/lib/students/importRow";
import { buildStudentSelfUpdate, STUDENT_SELF_EDITABLE_KEYS } from "@/lib/students/selfEdit";
import { buildOwnProfileGroups } from "@/lib/students/ownProfile";
import { classifyRowAgainstStudent, normalizeBulkCell, BULK_UPDATE_FIELDS } from "@/lib/students/bulkUpdate";
import { projectStudentForRole } from "@/lib/students/listProjection";
import type { StudentRecord } from "@/types";

const FLAG = "parentsWorkingOutside";
const DETAILS = "parentsWorkingOutsideDetails";
const field = (key: string) => ROSTER_FIELDS.find((f) => f.key === key)!;

describe("the new fields", () => {
  it("are defined with the requested wording, Yes/No then free text", () => {
    expect(field(FLAG).label).toBe("Parents Working in Other States/Country? (Yes/No)");
    expect(field(FLAG).kind).toBe("yesno");
    expect(field(DETAILS).label).toBe("If Yes - Enter Details (Place of Work, State/Country)");
    expect(field(DETAILS).kind).toBe("text");
  });
  it("sit right after the Family ID fields, before Remarks, in Additional Information", () => {
    const keys = ROSTER_DETAIL_GROUPS.find((g) => g.title === "Additional Information")!.keys;
    expect(keys).toEqual([
      "studiedOutsideAP", "studiedOutsideAPDetails", "familyIdLinkedOtherState", "familyIdLinkedOtherStateDetails", FLAG, DETAILS, "remarks",
    ]);
  });
  it("every sample row carries them so the template workbook has no hole", () => {
    for (const row of ROSTER_SAMPLE_ROWS) { expect(FLAG in row).toBe(true); expect(DETAILS in row).toBe(true); }
  });
});

describe("updated descriptions", () => {
  it("Admission Type examples are Spot Admission, Management, Convenor (no Direct)", () => {
    const f = field("admissionType");
    expect(f.sample).toContain("Spot Admission, Management, Convenor");
    expect(f.sample).not.toContain("Direct");
    expect(f.placeholder).toBe("Spot Admission");
    expect(ROSTER_SAMPLE_ROWS.some((r) => r.admissionType === "Direct")).toBe(false);
  });
  it("Studied Outside AP explains the one-year rule with schooling / Intermediate / Diploma", () => {
    const help = field("studiedOutsideAP").help ?? "";
    expect(help).toMatch(/at least one year outside Andhra Pradesh/);
    for (const w of ["schooling", "Intermediate", "Diploma"]) expect(help).toContain(w);
    expect(field("studiedOutsideAP").label).toBe("Studied Outside Andhra Pradesh? (Yes/No)");
  });
  it("Family ID gives Aadhaar, PAN, ration card and another identity document as examples", () => {
    const help = field("familyIdLinkedOtherState").help ?? "";
    for (const w of ["Aadhaar", "PAN", "ration card", "identity document"]) expect(help).toContain(w);
    expect(field("familyIdLinkedOtherState").label).toBe("Any Family ID Linked to Another State? (Yes/No)");
  });
});

describe("storage and forms", () => {
  it("the Add/Edit form payload stores Yes/No as a boolean and the details as text", () => {
    expect(rosterFormToPayload({ [FLAG]: "Yes", [DETAILS]: " Father - Dubai, UAE " })).toMatchObject({ [FLAG]: true, [DETAILS]: "Father - Dubai, UAE" });
    expect(rosterFormToPayload({ [FLAG]: "No" })).toEqual({ [FLAG]: false });
    expect(normalizeRosterDetails({ [FLAG]: "yes", [DETAILS]: "Mother - Pune, Maharashtra" })).toEqual({ [FLAG]: true, [DETAILS]: "Mother - Pune, Maharashtra" });
  });
  it("an Edit that blanks them writes an explicit null (a real clear)", () => {
    const p = rosterFormToPayload({ [FLAG]: "", [DETAILS]: "" }, { writeBlanksAsNull: true });
    expect(p[FLAG]).toBeNull();
    expect(p[DETAILS]).toBeNull();
  });
  it("display and form values round-trip; unset stays blank (existing students are untouched)", () => {
    const s = { parentsWorkingOutside: true, parentsWorkingOutsideDetails: "Dubai" } as Partial<StudentRecord>;
    expect(rosterFieldDisplay(field(FLAG), s)).toBe("Yes");
    expect(rosterFieldFormValue(field(FLAG), s)).toBe("Yes");
    expect(rosterFieldDisplay(field(DETAILS), s)).toBe("Dubai");
    expect(rosterFieldDisplay(field(FLAG), {})).toBe("");
    expect(rosterFieldFormValue(field(FLAG), {})).toBe("");
  });
});

describe("Excel import", () => {
  const base = { name: "A", course: "B.Tech", mobileNo: "9876543210" } as StudentImportRow;
  const section = { collegeId: "c", department: "CSE", name: "A", year: 1, regulation: "R20" };
  it("reads them into the student document", () => {
    const doc = buildStudentDoc(section as never, { ...base, [FLAG]: "Yes", [DETAILS]: "Father - Dubai, UAE" }, new Date());
    expect(doc[FLAG]).toBe(true);
    expect(doc[DETAILS]).toBe("Father - Dubai, UAE");
  });
  it("leaves them off when the cells are blank", () => {
    const doc = buildStudentDoc(section as never, base, new Date());
    expect(FLAG in doc).toBe(false);
    expect(DETAILS in doc).toBe(false);
  });
});

describe("student self-edit", () => {
  it("a student may edit both, and No clears the details", () => {
    expect(STUDENT_SELF_EDITABLE_KEYS).toContain(FLAG);
    expect(STUDENT_SELF_EDITABLE_KEYS).toContain(DETAILS);
    const stored = { [FLAG]: true, [DETAILS]: "Dubai" } as Partial<StudentRecord>;
    const r = buildStudentSelfUpdate(stored, { [FLAG]: "No" });
    expect(r.ok && r.updates).toEqual({ [FLAG]: false, [DETAILS]: null });
  });
  it("their profile page lists them under Additional Information", () => {
    const groups = buildOwnProfileGroups({ parentsWorkingOutside: true, parentsWorkingOutsideDetails: "Dubai" } as Partial<StudentRecord>);
    const rows = groups.find((g) => g.title === "Additional Information")!.rows;
    expect(rows.map((r) => r.label)).toEqual([field(FLAG).label, field(DETAILS).label]);
  });
});

describe("Update student data (bulk) and overwrite preview", () => {
  it("both fields are offered, Yes/No is validated, details are plain text", () => {
    expect([...BULK_UPDATE_FIELDS]).toEqual(expect.arrayContaining([FLAG, DETAILS]));
    expect(normalizeBulkCell(FLAG, "Yes")).toEqual({ ok: true, value: true });
    expect(normalizeBulkCell(FLAG, "maybe").ok).toBe(false);
    expect(normalizeBulkCell(DETAILS, "Father - Dubai, UAE")).toEqual({ ok: true, value: "Father - Dubai, UAE" });
  });
  it("a different value is an OVERWRITE shown with its before/after; a blank student is a FILL", () => {
    const stu = { id: "s1", data: { [FLAG]: false, [DETAILS]: "" } };
    const r = classifyRowAgainstStudent({ rowNumber: 2, mobile: "9", values: { [FLAG]: "Yes", [DETAILS]: "Dubai" } }, stu, { fields: [FLAG, DETAILS], fillOnly: false });
    const byKey = Object.fromEntries(r.changes.map((c) => [c.key, c]));
    expect(byKey[FLAG]).toMatchObject({ mode: "OVERWRITE", before: "No", after: "Yes", afterValue: true });
    expect(byKey[DETAILS]).toMatchObject({ mode: "FILL", before: "", after: "Dubai" });
  });
  it("answering No while details are on file is warned about, never erased", () => {
    const stu = { id: "s1", data: { [FLAG]: true, [DETAILS]: "Dubai" } };
    const r = classifyRowAgainstStudent({ rowNumber: 2, mobile: "9", values: { [FLAG]: "No" } }, stu, { fields: [FLAG], fillOnly: false });
    expect(r.warnings.join(" ")).toMatch(/Parents Working in Other States\/Country is No but details are on file/);
    expect(r.changes.map((c) => c.key)).toEqual([FLAG]);
  });
});

describe("who sees them in lists", () => {
  it("HOD / faculty list rows drop them like the other sensitive answers; the office keeps them", () => {
    const s = { id: "1", name: "A", [FLAG]: true, [DETAILS]: "Dubai" };
    expect(projectStudentForRole("HOD", s)).not.toHaveProperty(FLAG);
    expect(projectStudentForRole("HOD", s)).not.toHaveProperty(DETAILS);
    expect(projectStudentForRole("COLLEGE_OFFICE", s)).toHaveProperty(FLAG, true);
  });
});
