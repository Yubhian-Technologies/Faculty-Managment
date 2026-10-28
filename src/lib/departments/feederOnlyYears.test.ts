import { describe, expect, it } from "vitest";
import { feederOnlyYears, yearsInScope } from "@/lib/departments/hodScope";
import type { Department } from "@/types";

// VIT's real shape: Basic Science still lists every branch as a feeder for year 1,
// while each core branch has its own Years Taught 1-4. The core branch owns all
// four years, so the pickers must offer 1-4 (the server already agrees -
// departmentOwnsYearDirectly). A branch with NO Years Taught of its own keeps the
// old behaviour: the feeder's year is subtracted.

const BT = "cat-btech";
const dept = (o: Record<string, unknown>) => ({ isActive: true, ...o }) as unknown as Department;

const bs = dept({
  id: "bs", name: "Basic Science", hasSubDepartments: true,
  courseScopes: { [BT]: { assignedYears: [1], secondaryDepartments: ["CSBS", "NEW"] } },
});
const csbs = dept({ id: "csbs", name: "CSBS", courseScopes: { [BT]: { assignedYears: [1, 2, 3, 4], secondaryDepartments: [] } } });
const unconfigured = dept({ id: "new", name: "NEW" });
const all = [bs, csbs, unconfigured];

describe("feederOnlyYears", () => {
  it("a core department that claims year 1 itself is not 'fed' it", () => {
    expect(feederOnlyYears(csbs, all, BT)).toEqual([]);
  });

  it("a department with no Years Taught of its own still loses the feeder's year", () => {
    expect(feederOnlyYears(unconfigured, all, BT)).toEqual([1]);
  });
});

describe("yearsInScope for a core HOD (the Timetable / Sections year filter)", () => {
  it("offers years 1-4 even though Basic Science lists the branch as a feeder", () => {
    expect(yearsInScope(4, [csbs], new Map(), false, BT, all)).toEqual([1, 2, 3, 4]);
  });

  it("a department with no own years of its own still offers nothing (never 'every year')", () => {
    expect(yearsInScope(4, [unconfigured], new Map(), false, BT, all)).toEqual([]);
  });

  it("Basic Science itself still resolves to year 1 only", () => {
    expect(yearsInScope(4, [bs], new Map(), false, BT, all)).toEqual([1]);
  });
});
