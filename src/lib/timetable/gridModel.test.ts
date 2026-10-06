import { describe, expect, it } from "vitest";
import { timetableClassLine } from "./gridModel";

const base = { courseName: "Bachelor of Technology", departmentName: "Computer Science and Engineering" };

describe("timetableClassLine", () => {
  it("drops the owning department's prefix from a branch-picker section name", () => {
    expect(timetableClassLine({ ...base, year: 1, semesterLabel: "Sem 1-1", sectionName: "BSC-CSE-C" })).toBe("I B.Tech I Sem CSE-C");
    expect(timetableClassLine({ ...base, year: 1, semesterLabel: "Sem 1-2", sectionName: "BSE-CIVIL-A" })).toBe("I B.Tech II Sem CIVIL-A");
  });

  it("uses the semester within the year, not the year, from a 'year-semester' label", () => {
    expect(timetableClassLine({ ...base, year: 2, semesterLabel: "Sem 2-1", sectionName: "CSE-A" })).toBe("II B.Tech I Sem CSE-A");
  });

  it("keeps two-part and bare section names", () => {
    expect(timetableClassLine({ ...base, year: 3, semesterLabel: "Sem 3-2", sectionName: "CSE-B" })).toBe("III B.Tech II Sem CSE-B");
    expect(timetableClassLine({ ...base, year: 3, sectionName: "A" })).toBe("III B.Tech CSE-A");
  });
});

import { mergeCoTaughtSlots } from "@/lib/timetable/gridModel";

describe("mergeCoTaughtSlots", () => {
  type Slot = { subjectId: string; subjectName: string; facultyName: string; labBatch?: string; substituteFacultyName?: string; substituteDate?: string };
  const s = (over: Partial<Slot>): Slot => ({ subjectId: "chem", subjectName: "Chemistry Lab", facultyName: "A", ...over });

  it("merges the faculty of one subject into one entry, subject once", () => {
    const merged = mergeCoTaughtSlots([s({ facultyName: "A" }), s({ facultyName: "B" })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].facultyName).toBe("A, B");
  });
  it("lists each batch once", () => {
    const merged = mergeCoTaughtSlots([s({ facultyName: "A", labBatch: "Batch 1" }), s({ facultyName: "B", labBatch: "Batch 2" }), s({ facultyName: "C", labBatch: "Batch 2" })]);
    expect(merged[0].labBatch).toBe("Batch 1, Batch 2");
    expect(merged[0].facultyName).toBe("A, B, C");
  });
  it("keeps different subjects separate and in order", () => {
    const merged = mergeCoTaughtSlots([s({ subjectId: "x", subjectName: "X", facultyName: "A" }), s({ subjectId: "y", subjectName: "Y", facultyName: "B" })]);
    expect(merged.map((m) => m.subjectId)).toEqual(["x", "y"]);
  });
  it("leaves a single entry untouched, including its substitution", () => {
    const one = s({ substituteFacultyName: "Z", substituteDate: "2026-10-12" });
    expect(mergeCoTaughtSlots([one])[0]).toBe(one);
  });
  it("shows a cover under the covered faculty's slot", () => {
    const merged = mergeCoTaughtSlots([s({ facultyName: "A", substituteFacultyName: "Z" }), s({ facultyName: "B" })]);
    expect(merged[0].facultyName).toBe("Sub: Z, B");
    expect(merged[0].substituteFacultyName).toBeUndefined();
  });
});
