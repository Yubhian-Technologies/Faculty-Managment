import { describe, expect, it } from "vitest";
import type { Department } from "@/types";
import {
  buildDepartmentPickOptions,
  departmentPickValue,
  isDepartmentPickOffered,
  parseDepartmentPick,
} from "./departmentPickTree";

const dept = (over: Partial<Department> & { id: string; name: string }): Department =>
  ({ isActive: true, ...over }) as Department;

const BS = dept({ id: "bs", name: "Basic Science", hasSubDepartments: true });
const BSM = dept({ id: "bsm", name: "Basic Science - Maths", parentDepartmentId: "bs", managedDepartments: ["AIDS", "CSE"] });
const BSP = dept({ id: "bsp", name: "Basic Science - Physics", parentDepartmentId: "bs", managedDepartments: ["IT"] });
const AIDS = dept({ id: "aids", name: "AIDS" });
const CSE = dept({ id: "cse", name: "CSE" });
const IT = dept({ id: "it", name: "IT" });
const ALL = [BS, BSM, BSP, AIDS, CSE, IT];

describe("pick value", () => {
  it("round-trips department and core, and 'all' means nothing", () => {
    expect(parseDepartmentPick(departmentPickValue("CSE"))).toEqual({ department: "CSE", coreDepartment: "" });
    expect(parseDepartmentPick(departmentPickValue("Basic Science - Maths", "AIDS"))).toEqual({
      department: "Basic Science - Maths", coreDepartment: "AIDS",
    });
    expect(parseDepartmentPick("all")).toEqual({ department: "", coreDepartment: "" });
    expect(parseDepartmentPick("")).toEqual({ department: "", coreDepartment: "" });
  });
});

describe("buildDepartmentPickOptions", () => {
  const opts = buildDepartmentPickOptions(ALL, ALL, ["AIDS", "CSE", "IT"]);
  const labels = opts.map((o) => `${o.depth}:${o.label}`);

  it("lists each sub-department under its parent and each core branch under the department that groups it", () => {
    const i = (s: string) => labels.indexOf(s);
    expect(i("0:Basic Science")).toBeGreaterThanOrEqual(0);
    expect(i("1:Basic Science - Maths")).toBe(i("0:Basic Science") + 1);
    expect(i("2:AIDS")).toBe(i("1:Basic Science - Maths") + 1);
    expect(i("2:CSE")).toBe(i("2:AIDS") + 1);
    expect(i("1:Basic Science - Physics")).toBe(i("2:CSE") + 1);
    expect(i("2:IT")).toBe(i("1:Basic Science - Physics") + 1);
  });

  it("carries department + core on a core entry and only department on a plain one", () => {
    const core = opts.find((o) => o.depth === 2 && o.label === "AIDS")!;
    expect(parseDepartmentPick(core.value)).toEqual({ department: "Basic Science - Maths", coreDepartment: "AIDS" });
    const plain = opts.find((o) => o.value === "CSE")!;
    expect(parseDepartmentPick(plain.value)).toEqual({ department: "CSE", coreDepartment: "" });
  });

  it("leaves the core branches out when asked", () => {
    const flat = buildDepartmentPickOptions(ALL, ALL, ["AIDS", "CSE", "IT"], false);
    expect(flat.every((o) => o.coreDepartment === "")).toBe(true);
  });

  it("recognises a stale pick", () => {
    expect(isDepartmentPickOffered(opts, "all")).toBe(true);
    expect(isDepartmentPickOffered(opts, "Nope")).toBe(false);
  });
});
