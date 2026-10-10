import { describe, expect, it } from "vitest";
import { ROSTER_FIELDS } from "@/lib/students/rosterFields";
import { normalizeCasteCategory, normalizeImportDate, normalizeStudentImportRow, resolveStudentImportHeaders } from "./importHeaders";

// The header row of the college's own admission sheet, exactly as it is typed there.
const ADMISSION_SHEET_HEADERS = [
  "Sl.No", "Roll.No", "Admission.No", "Student Name", "Gender", "Blood Group", "Date Of Birth", "Category", "Caste",
  "Nationality", "Religion", "Mother Tongue", "Identification Marks", "Entrance Type", "Hallticket Number", "Rank",
  "Joining Date", "Seat Type", "Admission Type", "Land Line No.", "Mobile No.", "ScholarShip", "Email",
  "Distance From Residence", "Bank A/C No.", "Ration Card No.", "Adhar Card No.", "PHC", "Permanent Address",
  "Correspondence Address", "SSC Hall Ticket.No", "SSC Board", "SSC Year Of Pass", "SSC Marks", "SSC %",
  "SSC Institution", "SSC Grade Points", "Inter Hall Ticket.No", "Inter Board", "Inter Year Of Pass", "Inter Marks",
  "Inter %", "Inter Institution", "Inter Grade Points", "Diploma Hall Ticket.No", "Diploma Board",
  "Diploma Year Of Pass", "Diploma Marks", "Diploma %", "Diploma Institution", "Degree Hall Ticket.No", "Degree Board",
  "Degree Year Of Pass", "Degree Marks", "Degree %", "Degree Institution", "Father Name", "Father Occupation",
  "Annucal Income", "Father Mobile.No", "Mother Name", "Mother Occupation", "Mother Mobile.No",
];

const columns = ROSTER_FIELDS.map((f) => ({ key: f.key, label: f.label, aliases: f.aliases }));

describe("resolveStudentImportHeaders", () => {
  const { keyMap, unmatched } = resolveStudentImportHeaders(ADMISSION_SHEET_HEADERS, columns);
  const keyOf = (header: string) => keyMap[ADMISSION_SHEET_HEADERS.indexOf(header)];

  it("reads every column of the admission sheet, leaving only Sl.No out", () => {
    expect(unmatched).toEqual([]);
    expect(keyOf("Sl.No")).toBeUndefined();
    expect(Object.keys(keyMap)).toHaveLength(ADMISSION_SHEET_HEADERS.length - 1);
  });

  it("never sends two columns to the same field", () => {
    const keys = Object.values(keyMap);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("maps the differently-worded columns to the right fields", () => {
    expect(keyOf("Roll.No")).toBe("rollNumber");
    expect(keyOf("Student Name")).toBe("name");
    expect(keyOf("Mobile No.")).toBe("mobileNo");
    expect(keyOf("Hallticket Number")).toBe("hallTicketNo");
    expect(keyOf("Rank")).toBe("entranceRank");
    expect(keyOf("Joining Date")).toBe("dateOfJoining");
    expect(keyOf("Adhar Card No.")).toBe("aadharNo");
    expect(keyOf("PHC")).toBe("physicallyHandicapped");
    expect(keyOf("Correspondence Address")).toBe("temporaryAddress");
    expect(keyOf("Permanent Address")).toBe("permanentAddress");
    expect(keyOf("Father Mobile.No")).toBe("fatherContactNo");
    expect(keyOf("Mother Mobile.No")).toBe("motherContactNo");
    expect(keyOf("Annucal Income")).toBe("annualIncome");
    expect(keyOf("SSC Hall Ticket.No")).toBe("sscHallTicketNo");
    expect(keyOf("Inter %")).toBe("interPercentage");
    expect(keyOf("Degree Institution")).toBe("degreeInstitution");
  });

  it("reads Category as the roster's Caste and the sheet's Caste as Sub Caste", () => {
    expect(keyOf("Category")).toBe("caste");
    expect(keyOf("Caste")).toBe("subCaste");
  });

  it("leaves Caste alone when the file has its own Sub Caste column, or no Category", () => {
    const own = resolveStudentImportHeaders(["Roll No", "Caste", "Sub Caste"], columns).keyMap;
    expect(own).toEqual({ 0: "rollNumber", 1: "caste", 2: "subCaste" });
    expect(resolveStudentImportHeaders(["Roll No", "Caste"], columns).keyMap).toEqual({ 0: "rollNumber", 1: "caste" });
  });

  it("still reports a column it does not know", () => {
    expect(resolveStudentImportHeaders(["Roll No", "Favourite Colour"], columns).unmatched).toEqual(["Favourite Colour"]);
  });
});

describe("normalizeImportDate", () => {
  it("turns day-first dates into YYYY-MM-DD", () => {
    expect(normalizeImportDate("31-08-2026")).toBe("2026-08-31");
    expect(normalizeImportDate("1/9/2004")).toBe("2004-09-01");
    expect(normalizeImportDate("05.11.2006")).toBe("2006-11-05");
    expect(normalizeImportDate("12-Aug-2004")).toBe("2004-08-12");
    expect(normalizeImportDate("3 September 2005")).toBe("2005-09-03");
  });
  it("keeps YYYY-MM-DD, dropping a time", () => {
    expect(normalizeImportDate("2004-08-12")).toBe("2004-08-12");
    expect(normalizeImportDate("2004-08-12T00:00:00.000Z")).toBe("2004-08-12");
  });
  it("returns what it cannot read unchanged", () => {
    expect(normalizeImportDate("31-02-2004")).toBe("31-02-2004");
    expect(normalizeImportDate("not known")).toBe("not known");
    expect(normalizeImportDate("")).toBe("");
  });
});

describe("normalizeCasteCategory", () => {
  it("spells a category the roster's way", () => {
    expect(normalizeCasteCategory("bc_a")).toBe("BC-A");
    expect(normalizeCasteCategory("BC B")).toBe("BC-B");
    expect(normalizeCasteCategory("BCD")).toBe("BC-D");
    expect(normalizeCasteCategory(" oc ")).toBe("OC");
  });
  it("keeps a value that is not a category as typed", () => {
    expect(normalizeCasteCategory("Kapu")).toBe("Kapu");
  });
});

describe("normalizeStudentImportRow", () => {
  it("fixes the dates and the category and touches nothing else", () => {
    expect(normalizeStudentImportRow({ name: "A", dateOfBirth: "12/08/2004", dateOfJoining: "31-08-2026", caste: "sc", subCaste: "Mala" }))
      .toEqual({ name: "A", dateOfBirth: "2004-08-12", dateOfJoining: "2026-08-31", caste: "SC", subCaste: "Mala" });
  });
});
