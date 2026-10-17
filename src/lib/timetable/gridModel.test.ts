import { describe, expect, it } from "vitest";
import { formatYearSemBranch, formatRoomNo, timetableClassLine, buildAllocationList } from "./gridModel";
import type { TimetableSlot } from "@/types";

const base = { courseName: "Bachelor of Technology", departmentName: "Computer Science and Engineering" };

describe("formatYearSemBranch", () => {
  it("formats class line as Year /Sem/Branch", () => {
    expect(formatYearSemBranch({ ...base, year: 1, semesterLabel: "Sem 1-1", sectionName: "AIDS-A" })).toBe("Year /Sem/Branch: I-B. Tech / I-Sem / AIDS-A");
    expect(formatYearSemBranch({ ...base, year: 1, semesterLabel: "Sem 1-1", sectionName: "CE" })).toBe("Year /Sem/Branch: I-B. Tech / I-Sem / CE");
  });

  it("formats room number string", () => {
    expect(formatRoomNo("B-302")).toBe("ROOM NO: B-302");
    expect(formatRoomNo("Room: B-208")).toBe("ROOM NO: B-208");
  });
});

describe("timetableClassLine", () => {
  it("drops the owning department's prefix from a branch-picker section name", () => {
    expect(timetableClassLine({ ...base, year: 1, semesterLabel: "Sem 1-1", sectionName: "BSC-CSE-C" })).toBe("Year /Sem/Branch: I-B. Tech / I-Sem / CSE-C");
  });
});

import { mergeCoTaughtSlots } from "@/lib/timetable/gridModel";

describe("mergeCoTaughtSlots", () => {
  type Slot = { subjectId: string; subjectName: string; facultyName: string; labBatch?: string; substituteFacultyName?: string; substituteDate?: string; cellColor?: string };
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
  it("keeps the colour when only the second co-taught half has one", () => {
    const merged = mergeCoTaughtSlots([s({ facultyName: "A" }), s({ facultyName: "B", cellColor: "orange" })]);
    expect(merged[0].cellColor).toBe("orange");
  });
});

describe("buildAllocationList - hoursPerWeek is counted from the published slots", () => {
  const slot = (over: Partial<TimetableSlot>): TimetableSlot => ({
    id: "s", collegeId: "c", department: "CSE", assignmentId: "a", facultyId: "f1",
    facultyName: "Dr. A", courseId: "course", year: 2, sectionId: "sec",
    subjectId: "dsa", subjectName: "Data Structures", day: "MON", periodNumber: 1,
    ...over,
  } as TimetableSlot);

  it("counts one period per day+period, ignoring any stale assignment hoursPerWeek", () => {
    const slots = [
      slot({ day: "MON", periodNumber: 1 }),
      slot({ day: "WED", periodNumber: 3 }),
      slot({ day: "FRI", periodNumber: 2 }),
    ];
    // Assignment claims 5 hrs/wk, but only 3 periods are actually on the published grid.
    const list = buildAllocationList(slots, { assignments: [{ subjectId: "dsa", facultyName: "Dr. A" }] });
    expect(list).toHaveLength(1);
    expect(list[0].hoursPerWeek).toBe(3);
  });

  it("does not double-count a period split into parallel lab batches", () => {
    const slots = [
      slot({ day: "TUE", periodNumber: 4, labBatch: "Batch 1" }),
      slot({ day: "TUE", periodNumber: 4, labBatch: "Batch 2" }),
      slot({ day: "TUE", periodNumber: 5, labBatch: "Batch 1" }),
      slot({ day: "TUE", periodNumber: 5, labBatch: "Batch 2" }),
    ];
    const list = buildAllocationList(slots);
    expect(list[0].hoursPerWeek).toBe(2);
    expect(list[0].labBatches.sort()).toEqual(["Batch 1", "Batch 2"]);
  });

  it("counts each distinct subject separately", () => {
    const slots = [
      slot({ subjectId: "dsa", subjectName: "Data Structures", day: "MON", periodNumber: 1 }),
      slot({ subjectId: "dsa", subjectName: "Data Structures", day: "TUE", periodNumber: 1 }),
      slot({ subjectId: "os", subjectName: "Operating Systems", day: "MON", periodNumber: 2 }),
    ];
    const list = buildAllocationList(slots);
    const byId = Object.fromEntries(list.map((e) => [e.name, e.hoursPerWeek]));
    expect(byId["Data Structures"]).toBe(2);
    expect(byId["Operating Systems"]).toBe(1);
  });
});
