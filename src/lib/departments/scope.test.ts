import { describe, it, expect } from "vitest";
import {
  canHodEditDepartment,
  canHodManageFacultyDepartment,
  canHodEditDepartmentId,
  editableDepartmentNames,
  facultyManageableDepartmentNames,
  ownDepartmentNames,
  type HodDepartmentScope,
} from "@/lib/departments/scope";

// Pins the own/child/managed-branch distinction the 2026-09-25 audit fix
// depends on: `canHodEditDepartment` grants a sub-HOD full control (sections,
// subjects, timetable) over everything they own, head a true child of, OR
// were handed as a managed/grouped branch - but `canHodManageFacultyDepartment`
// (and everything derived from it: faculty create/link-hod/login, Supporting
// Staff's equivalent) deliberately stops at own+child. A managed branch's
// faculty roster stays with a real HOD until it gets its own dedicated login -
// this is exactly the gap 3 routes (faculty POST, link-hod POST,
// faculty/[id]/login POST) used to get wrong by calling canHodEditDepartment
// instead.

// A sub-HOD of "BS-ENGLISH" (child of "BASIC SCIENCE") who has also been
// handed "AI" and "IT" as managed/grouped branches - mirrors the shape
// getHodDepartmentScope actually returns (see its own doc-comment).
const subHodScope: HodDepartmentScope = {
  departmentName: "BS-ENGLISH",
  departmentId: "bse",
  ownDepartmentNames: ["BS-ENGLISH"],
  ownDepartmentIds: ["bse"],
  childDepartmentNames: [],
  childDepartmentIds: [],
  managedDepartmentNames: ["AI", "IT"],
  managedDepartmentIds: ["ai", "it"],
};

// A parent HOD who directly heads "BASIC SCIENCE", which has a true
// sub-department "BS-ENGLISH", which in turn manages "AI"/"IT" - the parent's
// scope rolls the sub-HOD's managed branches up too (getHodDepartmentScope's
// documented "manages the whole tree" behavior).
const parentHodScope: HodDepartmentScope = {
  departmentName: "BASIC SCIENCE",
  departmentId: "bs",
  ownDepartmentNames: ["BASIC SCIENCE"],
  ownDepartmentIds: ["bs"],
  childDepartmentNames: ["BS-ENGLISH"],
  childDepartmentIds: ["bse"],
  managedDepartmentNames: ["AI", "IT"],
  managedDepartmentIds: ["ai", "it"],
};

// An HOD heading more than one department at once (Principal-assigned), with
// no children/managed branches at all - the plain case.
const multiDeptHodScope: HodDepartmentScope = {
  departmentName: "CIVIL",
  departmentId: "civ",
  ownDepartmentNames: ["CIVIL", "MECH"],
  ownDepartmentIds: ["civ", "mech"],
  childDepartmentNames: [],
  childDepartmentIds: [],
  managedDepartmentNames: [],
  managedDepartmentIds: [],
};

describe("canHodEditDepartment", () => {
  it("allows a sub-HOD's own department", () => {
    expect(canHodEditDepartment(subHodScope, "BS-ENGLISH")).toBe(true);
  });

  it("allows a managed/grouped branch - full edit rights over sections/subjects/timetable", () => {
    expect(canHodEditDepartment(subHodScope, "AI")).toBe(true);
    expect(canHodEditDepartment(subHodScope, "IT")).toBe(true);
  });

  it("allows a parent HOD's true child department", () => {
    expect(canHodEditDepartment(parentHodScope, "BS-ENGLISH")).toBe(true);
  });

  it("allows a parent HOD's rolled-up managed branch (their sub-HOD's grouping)", () => {
    expect(canHodEditDepartment(parentHodScope, "AI")).toBe(true);
  });

  it("refuses a department outside the HOD's tree entirely", () => {
    expect(canHodEditDepartment(subHodScope, "MECH")).toBe(false);
  });

  it("refuses an empty department name", () => {
    expect(canHodEditDepartment(subHodScope, "")).toBe(false);
  });

  it("allows every department a multi-department HOD directly heads", () => {
    expect(canHodEditDepartment(multiDeptHodScope, "CIVIL")).toBe(true);
    expect(canHodEditDepartment(multiDeptHodScope, "MECH")).toBe(true);
  });
});

describe("canHodManageFacultyDepartment - narrower than canHodEditDepartment", () => {
  it("allows a sub-HOD's own department", () => {
    expect(canHodManageFacultyDepartment(subHodScope, "BS-ENGLISH")).toBe(true);
  });

  it("REFUSES a managed/grouped branch - a managed branch's faculty roster is never this HOD's to see or manage", () => {
    expect(canHodManageFacultyDepartment(subHodScope, "AI")).toBe(false);
    expect(canHodManageFacultyDepartment(subHodScope, "IT")).toBe(false);
  });

  it("allows a parent HOD's true child department", () => {
    expect(canHodManageFacultyDepartment(parentHodScope, "BS-ENGLISH")).toBe(true);
  });

  it("REFUSES a parent HOD's rolled-up managed branch too - not even the root HOD gets that branch's faculty", () => {
    expect(canHodManageFacultyDepartment(parentHodScope, "AI")).toBe(false);
    expect(canHodManageFacultyDepartment(parentHodScope, "IT")).toBe(false);
  });

  it("refuses a department outside the HOD's tree entirely", () => {
    expect(canHodManageFacultyDepartment(subHodScope, "MECH")).toBe(false);
  });

  it("refuses an empty department name", () => {
    expect(canHodManageFacultyDepartment(subHodScope, "")).toBe(false);
  });

  it("allows every department a multi-department HOD directly heads", () => {
    expect(canHodManageFacultyDepartment(multiDeptHodScope, "CIVIL")).toBe(true);
    expect(canHodManageFacultyDepartment(multiDeptHodScope, "MECH")).toBe(true);
  });
});

describe("canHodEditDepartmentId - same rule, keyed by id", () => {
  it("allows own/child/managed ids", () => {
    expect(canHodEditDepartmentId(subHodScope, "bse")).toBe(true);
    expect(canHodEditDepartmentId(subHodScope, "ai")).toBe(true);
    expect(canHodEditDepartmentId(parentHodScope, "bse")).toBe(true);
  });

  it("refuses an id outside the HOD's tree, and an empty id", () => {
    expect(canHodEditDepartmentId(subHodScope, "mech")).toBe(false);
    expect(canHodEditDepartmentId(subHodScope, "")).toBe(false);
  });
});

describe("editableDepartmentNames / facultyManageableDepartmentNames", () => {
  it("editableDepartmentNames includes managed branches", () => {
    expect(editableDepartmentNames(subHodScope).sort()).toEqual(["AI", "BS-ENGLISH", "IT"].sort());
  });

  it("facultyManageableDepartmentNames excludes managed branches", () => {
    expect(facultyManageableDepartmentNames(subHodScope)).toEqual(["BS-ENGLISH"]);
    expect(facultyManageableDepartmentNames(parentHodScope)).toEqual(["BASIC SCIENCE", "BS-ENGLISH"]);
  });
});

describe("ownDepartmentNames - literal tree identity, excludes managed branches", () => {
  it("is own + true children only", () => {
    expect(ownDepartmentNames(parentHodScope)).toEqual(["BASIC SCIENCE", "BS-ENGLISH"]);
  });

  it("never includes a managed/grouped branch", () => {
    expect(ownDepartmentNames(subHodScope)).not.toContain("AI");
    expect(ownDepartmentNames(subHodScope)).not.toContain("IT");
  });

  it("is empty when the scope has no department at all", () => {
    const emptyScope: HodDepartmentScope = {
      departmentName: "", departmentId: null,
      ownDepartmentNames: [], ownDepartmentIds: [],
      childDepartmentNames: [], childDepartmentIds: [],
      managedDepartmentNames: [], managedDepartmentIds: [],
    };
    expect(ownDepartmentNames(emptyScope)).toEqual([]);
  });
});
