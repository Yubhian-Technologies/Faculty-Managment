import { describe, expect, it } from "vitest";
import { findHoursMismatches, hoursMatchStatus, placedHoursForAssignment } from "./hoursMatch";

const assignment = (id: string, hoursPerWeek: number, subjectName = "Data Structures", facultyName = "Ramesh Yadav") =>
  ({ id, subjectName, facultyName, hoursPerWeek });

describe("hoursMatchStatus", () => {
  it("is 'under' when fewer periods are placed than planned", () => {
    expect(hoursMatchStatus(4, 3)).toBe("under");
  });
  it("is 'over' when more periods are placed than planned", () => {
    expect(hoursMatchStatus(4, 5)).toBe("over");
  });
  it("is 'match' when they're equal", () => {
    expect(hoursMatchStatus(4, 4)).toBe("match");
  });
});

describe("placedHoursForAssignment", () => {
  it("counts one per placed period, including every period of a lab block", () => {
    const slots = [
      { assignmentId: "a1" }, { assignmentId: "a1" }, { assignmentId: "a1" }, // a 3-period lab block
      { assignmentId: "a2" },
    ];
    expect(placedHoursForAssignment("a1", slots)).toBe(3);
    expect(placedHoursForAssignment("a2", slots)).toBe(1);
    expect(placedHoursForAssignment("a3", slots)).toBe(0);
  });
});

describe("findHoursMismatches", () => {
  it("reports nothing when every assignment's placed periods match its target", () => {
    const assignments = [assignment("a1", 3)];
    const slots = [{ assignmentId: "a1" }, { assignmentId: "a1" }, { assignmentId: "a1" }];
    expect(findHoursMismatches(assignments, slots)).toEqual([]);
  });

  it("reports an under-placed assignment", () => {
    const assignments = [assignment("a1", 4)];
    const slots = [{ assignmentId: "a1" }];
    expect(findHoursMismatches(assignments, slots)).toEqual([
      { assignmentId: "a1", subjectName: "Data Structures", facultyName: "Ramesh Yadav", hoursPerWeek: 4, placed: 1, status: "under" },
    ]);
  });

  it("reports an over-placed assignment", () => {
    const assignments = [assignment("a1", 2)];
    const slots = [{ assignmentId: "a1" }, { assignmentId: "a1" }, { assignmentId: "a1" }];
    expect(findHoursMismatches(assignments, slots)[0]).toMatchObject({ status: "over", placed: 3, hoursPerWeek: 2 });
  });

  it("treats an assignment with zero placed periods as under, not a crash", () => {
    const assignments = [assignment("a1", 3)];
    expect(findHoursMismatches(assignments, [])).toMatchObject([{ status: "under", placed: 0 }]);
  });

  it("only reports the mismatched ones out of several", () => {
    const assignments = [assignment("a1", 3, "Data Structures"), assignment("a2", 2, "DBMS")];
    const slots = [
      { assignmentId: "a1" }, { assignmentId: "a1" }, { assignmentId: "a1" }, // matches
      { assignmentId: "a2" }, // under
    ];
    const mismatches = findHoursMismatches(assignments, slots);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].subjectName).toBe("DBMS");
  });
});
