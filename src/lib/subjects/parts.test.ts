import { describe, expect, it } from "vitest";
import { cleanSubjectParts, firstPartFor, midPaperBranch, parseUnitList, partBranchLabel, partForMid, partLabel, partOfBranch, partUnitSplit, sectionMidPart, unitListLabel } from "./parts";
import { reviewDepartmentsOf } from "./ownerDepartment";
import { paperBranchLabel, sectionsForScope } from "@/lib/midBank/assignments";

const depts = new Map([["eee", "Electrical and Electronics Engineering"], ["ece", "Electronics and Communication Engineering"]]);
const beee = [
  { name: "Electrical", units: "1-3", departmentId: "eee" },
  { name: "Electronics", units: "4-6", departmentId: "ece" },
];

describe("subject taught in parts", () => {
  it("reads unit lists", () => {
    expect(parseUnitList("1-3")).toEqual([1, 2, 3]);
    expect(parseUnitList("4 - 6, 8")).toEqual([4, 5, 6, 8]);
    expect(parseUnitList("3-1")).toBeNull();
    expect(parseUnitList("x")).toBeNull();
    expect(unitListLabel([1, 2, 3, 5])).toBe("1-3, 5");
  });

  it("accepts BEEE: Electrical 1-3 by EEE, Electronics 4-6 by ECE", () => {
    const { parts, error } = cleanSubjectParts(beee, depts);
    expect(error).toBe("");
    expect(parts.map((p) => [p.key, p.name, p.units, p.departmentName])).toEqual([
      ["A", "Electrical", [1, 2, 3], "Electrical and Electronics Engineering"],
      ["B", "Electronics", [4, 5, 6], "Electronics and Communication Engineering"],
    ]);
    expect(partLabel(parts[1])).toBe("Electronics (units 4-6)");
  });

  it("refuses overlaps, gaps, a missing department and units past the frozen syllabus", () => {
    expect(cleanSubjectParts([beee[0], { ...beee[1], units: "3-6" }], depts).error).toMatch(/Unit 3 is in both/);
    expect(cleanSubjectParts([beee[0], { ...beee[1], units: "5-6" }], depts).error).toMatch(/Unit 4 is in neither/);
    expect(cleanSubjectParts([beee[0], { ...beee[1], departmentId: "" }], depts).error).toMatch(/Select Part B's department/);
    expect(cleanSubjectParts(beee, depts, 5).error).toMatch(/5 units - unit 6/);
    expect(cleanSubjectParts(beee, depts, 7).error).toMatch(/Unit 7 is in neither/);
    expect(cleanSubjectParts([beee[0]], depts).error).toMatch(/exactly two/);
  });

  it("gives each section its own Mid part from the order Academics set", () => {
    const { parts } = cleanSubjectParts(beee, depts);
    const subject = { parts, partFirst: { "ece-b": "B" as const } };
    // ECE-A (default): Electrical in Mid 1, Electronics in Mid 2.
    expect(firstPartFor(subject, "ece-a")).toBe("A");
    expect(sectionMidPart(subject, "ece-a", 1)?.units).toEqual([1, 2, 3]);
    expect(sectionMidPart(subject, "ece-a", 2)?.units).toEqual([4, 5, 6]);
    // ECE-B took Electronics first.
    expect(sectionMidPart(subject, "ece-b", 1)?.name).toBe("Electronics");
    expect(sectionMidPart(subject, "ece-b", 2)?.name).toBe("Electrical");
    expect(partForMid(parts, "A", 3)).toBeNull();
    // A subject not taught in parts: no part (the usual unit split applies).
    expect(sectionMidPart({}, "ece-a", 1)).toBeNull();
  });
});

describe("Mid papers per part", () => {
  const { parts } = cleanSubjectParts(beee, depts);
  const subject = { parts, partFirst: { "ece-b": "B" as const }, ownerDepartments: [{ id: "eee", name: "Electrical and Electronics Engineering" }, { id: "ece", name: "Electronics and Communication Engineering" }] };
  const elec = partBranchLabel(parts[0]); // "Electrical (Part A)"

  it("files each section under the part it writes in the Mid", () => {
    expect(elec).toBe("Electrical (Part A)");
    expect(midPaperBranch(subject, "ece-a", "ECE", 1)).toBe("Electrical (Part A)");
    expect(midPaperBranch(subject, "ece-b", "ECE", 1)).toBe("Electronics (Part B)");
    expect(midPaperBranch(subject, "ece-b", "ECE", 2)).toBe("Electrical (Part A)");
    expect(midPaperBranch({}, "x", "CSE", 1)).toBe("CSE");
    expect(partOfBranch(subject, "ECE")).toBeNull();
  });

  it("a part's paper covers its units in this Mid, and goes to its own department's HOD", () => {
    expect(partUnitSplit(subject, elec, 2)).toEqual({ "2": [1, 2, 3], "1": [4, 5, 6] });
    expect(partUnitSplit(subject, "ECE", 1)).toBeNull();
    expect(reviewDepartmentsOf(elec, subject)).toEqual(["Electrical and Electronics Engineering"]);
    expect(reviewDepartmentsOf("Electronics (Part B)", subject)).toEqual(["Electronics and Communication Engineering"]);
  });

  it("prints a part's paper with the branches and sections it covers", () => {
    const rows = [
      { subjectId: "s", subjectName: "BEEE", subjectCode: "B", branch: elec, realBranch: "CSE", sectionId: "cse-a", sectionName: "CSE-A", facultyId: "f1", facultyName: "F1" },
      { subjectId: "s", subjectName: "BEEE", subjectCode: "B", branch: elec, realBranch: "ECE", sectionId: "ece-a", sectionName: "ECE-A", facultyId: "f2", facultyName: "F2" },
    ];
    const sections = sectionsForScope(rows, "s", elec);
    expect(sections.map((x) => x.branch)).toEqual(["CSE", "ECE"]);
    const l = paperBranchLabel({ branch: elec, sections }, (n) => n, new Map([["CSE", 4], ["ECE", 3]]));
    expect(l.branch).toBe("CSE (CSE-A) · ECE (ECE-A)");
  });
});

describe("a per-branch paper of a parted subject", () => {
  it("takes the part its sections write, and moves questions unit by position", async () => {
    const { partSplitForSections } = await import("./parts");
    const { parts } = cleanSubjectParts(beee, depts);
    const subject = { parts, partFirst: { "ece-a": "B" as const, "ece-b": "B" as const } };
    expect(partSplitForSections(subject, ["ece-a", "ece-b"], 1)).toEqual({ "1": [4, 5, 6], "2": [1, 2, 3] });
    expect(partSplitForSections(subject, ["ece-a", "ece-c"], 1)).toBeNull(); // mixed: no single part
    const { remapQuestions } = await import("@/lib/midPapers/pattern");
    const part = { id: "MID", label: "MID", kind: "DESCRIPTIVE", questions: 6, marks: 5, perUnit: 2, unitLayout: [1, 1, 2, 2, 3, 3] };
    const next = { ...part, unitLayout: [4, 4, 5, 5, 6, 6] };
    const r = remapQuestions({ parts: [part], setsPerFaculty: 1 } as never, { parts: [next], setsPerFaculty: 1 } as never,
      [{ id: "1_MID_1", set: 1, partId: "MID", no: 1, unit: 1 }, { id: "1_MID_3", set: 1, partId: "MID", no: 3, unit: 2 }], [1, 2, 3], [4, 5, 6]);
    expect(r.dropped).toEqual([]);
    expect(r.moves).toEqual([{ from: "1_MID_1", to: "1_MID_1", unit: 4 }, { from: "1_MID_3", to: "1_MID_3", unit: 5 }]);
  });
});
