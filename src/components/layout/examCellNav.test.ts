import { describe, expect, it } from "vitest";
import { computeItemModule, getNavItemsForRole, migrateHiddenModules } from "./navConfig";

// Exam Cell sidebar grouped by job: same pages, new groups, and a module the
// Super Admin hid before the split stays hidden after it.
describe("Exam Cell sidebar groups", () => {
  const items = getNavItemsForRole("EXAM_CELL");
  const moduleOf = (href: string) => computeItemModule(items, items.findIndex((i) => i.href === href));

  it("dashboard first, then Mid Exams, Exam Conduct, Results, Student Services, Attendance, Communication, Settings, Personal", () => {
    expect(items[0].href).toBe("/exam-cell");
    expect(items.filter((i) => i.section).map((i) => i.section)).toEqual(
      ["Mid Exams", "Exam Conduct", "Results", "Student Services", "Attendance", "Communication", "Settings", "Personal"]);
    expect(moduleOf("/exam-cell/question-banks")).toBe("Mid Exams");
    expect(moduleOf("/exam-cell/timetable-view")).toBe("Exam Conduct");
    expect(moduleOf("/exam-cell/guidelines")).toBe("Communication");
    expect(moduleOf("/exam-cell/attendance")).toBe("Personal");
  });

  it("a hidden General / My Work module stays hidden in every group its pages moved to", () => {
    expect(migrateHiddenModules("EXAM_CELL", ["General"])).toEqual(expect.arrayContaining(
      ["Mid Exams", "Exam Conduct", "Results", "Student Services", "Attendance", "Communication", "Settings"]));
    expect(migrateHiddenModules("EXAM_CELL", ["General"])).not.toContain("Personal");
    expect(migrateHiddenModules("EXAM_CELL", ["My Work"])).toContain("Personal");
  });
});
