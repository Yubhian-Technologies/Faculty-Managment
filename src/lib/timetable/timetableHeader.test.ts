import { describe, expect, it } from "vitest";
import { buildTimetableHeaderLines, departmentHeading, facultyInitials, formatWefDate, timetableTitle } from "./timetableHeader";

describe("timetable header", () => {
  it("builds the year-sem-section / branch / class in-charge / W.E.F / room lines", () => {
    expect(
      buildTimetableHeaderLines({
        courseName: "Bachelor of Technology", year: 1, semesterLabel: "Sem 1-1", sectionName: "CSE-A",
        departmentName: "Computer Science", classroom: "Room No: B-304",
        classInchargeName: "Dr. N A G K Manikanta Kopuri", effectiveDate: "2026-07-20",
      })
    ).toEqual({
      yearLine: "YEAR-SEM-SECTION : I B.Tech-I Sem-CSE-A",
      branchLine: "BRANCH : Computer Science",
      inchargeLine: "Class I/C: Dr. N A G K Manikanta Kopuri",
      wefLine: "W.E.F : 20 July 2026",
      roomLine: "ROOM NO : B-304",
    });
  });

  it("works the section out from how it is stored", () => {
    const line = (sectionName: string) =>
      buildTimetableHeaderLines({ courseName: "B.Tech", year: 2, semesterLabel: "Sem 2-1", sectionName, departmentName: "Civil Engineering" }).yearLine;
    expect(line("CSE-C")).toBe("YEAR-SEM-SECTION : II B.Tech-I Sem-CSE-C");
    expect(line("BSC-CSE-C")).toBe("YEAR-SEM-SECTION : II B.Tech-I Sem-CSE-C");
    expect(line("A")).toBe("YEAR-SEM-SECTION : II B.Tech-I Sem-CE-A");
    expect(line("Section B")).toBe("YEAR-SEM-SECTION : II B.Tech-I Sem-CE-B");
  });

  it("leaves off whatever is not known", () => {
    expect(buildTimetableHeaderLines({})).toEqual({ yearLine: "", branchLine: "", inchargeLine: "", wefLine: "", roomLine: "" });
    expect(formatWefDate("")).toBe("");
  });

  it("titles the sheet and department", () => {
    expect(timetableTitle("2026-27")).toBe("Time Table : 2026-27");
    expect(timetableTitle()).toBe("Time Table");
    expect(departmentHeading("Civil Engineering")).toBe("DEPARTMENT OF CIVIL ENGINEERING");
    expect(departmentHeading("Department of Civil Engineering")).toBe("DEPARTMENT OF CIVIL ENGINEERING");
  });

  it("takes initials, one set per faculty", () => {
    expect(facultyInitials("Dr.Pala Gireesh Kumar")).toBe("PGK");
    expect(facultyInitials("Dr.G.Reddy Babu")).toBe("GRB");
    expect(facultyInitials("Dr.Y.Phani, Mr.N.Haripavan")).toBe("YP/NH");
    expect(facultyInitials("")).toBe("");
  });
});

describe("subject list grouping", () => {
  it("lists Theory first, then Practical, each numbered on its own", async () => {
    const { groupAllocationByType } = await import("./timetableHeader");
    const e = (name: string, subjectType?: string) => ({ code: name, shortCode: name, name, subjectType, faculty: "x", labBatches: [] }) as never;
    const groups = groupAllocationByType([e("Surveying Lab", "PRACTICAL"), e("Fluid Mechanics", "THEORY"), e("SOM Laboratory"), e("Statics"), e("Sports", "NON_TEACHING")]);
    expect(groups.map((g) => [g.label, g.entries.map((x: { name: string }) => x.name)])).toEqual([
      ["Theory", ["Fluid Mechanics", "Statics"]],
      ["Practical", ["Surveying Lab", "SOM Laboratory"]],
      ["Co-Curricular", ["Sports"]],
    ]);
  });
});

describe("faculty timetable header and bottom", () => {
  it("titles by academic year and the semester's place in the year", async () => {
    const { facultyTimetableTitle, semesterInYear, facultyClassLabel } = await import("./timetableHeader");
    expect(semesterInYear("5, 7")).toBe("I Sem");
    expect(semesterInYear("4")).toBe("II Sem");
    expect(semesterInYear("3, 4")).toBe("");
    expect(semesterInYear("—")).toBe("");
    expect(facultyTimetableTitle("2026-27", "5")).toBe("Time Table : 2026-27 I Sem");
    expect(facultyTimetableTitle(undefined, "—")).toBe("Time Table");
    expect(facultyClassLabel({ courseName: "Bachelor of Technology", year: 4, semester: 7, sectionName: "A" })).toBe("IV B.Tech-I Sem-A");
    expect(facultyClassLabel({ courseName: "Bachelor of Technology", year: 3, sectionName: "CSBS-A", departmentName: "Computer Science and Business Systems" })).toBe("III B.Tech-CSBS-A");
    expect(facultyClassLabel({ courseName: "Bachelor of Technology", year: 3, semester: 5, sectionName: "A", departmentName: "Computer Science and Engineering" })).toBe("III B.Tech-I Sem-CSE-A");
  });
});
