import { describe, expect, it } from "vitest";
import type { Department } from "@/types";
import { resolveRollupDepartmentNames } from "@/lib/students/departmentRollup";
import { fetchStudentsPage } from "@/lib/students/paginatedList";
import { fakeStudentsCollection } from "@/lib/students/fakeStudentsCollection.testutil";

const dept = (over: Partial<Department> & { id: string; name: string }): Department =>
  ({ isActive: true, ...over }) as Department;

// A college's sections collection, reduced to the one question the resolver asks.
function collegeWithSections(sectionDepartments: string[], failing = false) {
  const reads: string[] = [];
  const ref = {
    collection: (name: string) => ({
      where: (field: string, _op: string, value: string) => ({
        limit: () => ({
          get: async () => {
            reads.push(`${name}.${field}==${value}`);
            if (failing) throw new Error("boom");
            const docs = sectionDepartments.filter((d) => d === value);
            return { empty: docs.length === 0, docs };
          },
        }),
      }),
    }),
  } as unknown as FirebaseFirestore.DocumentReference;
  return { ref, reads };
}

// VIT shape: a parent that only organises, children that manage branches.
const BS = dept({ id: "bs", name: "Basic Science", hasSubDepartments: true });
const BSM = dept({ id: "bsm", name: "Basic Science - Maths", parentDepartmentId: "bs", managedDepartments: ["AIDS"] });
const BSP = dept({ id: "bsp", name: "Basic Science - Physics", parentDepartmentId: "bs", managedDepartments: ["CSE"] });
const AIDS = dept({ id: "aids", name: "AIDS" });
const CSE = dept({ id: "cse", name: "CSE" });
// Women's-university shape: a core that runs sections AND has a sub-department that does.
const ECE = dept({ id: "ece", name: "ECE", hasSubDepartments: true });
const VLSI = dept({ id: "vlsi", name: "VLSI", parentDepartmentId: "ece" });
const ALL = [BS, BSM, BSP, AIDS, CSE, ECE, VLSI];

describe("resolveRollupDepartmentNames", () => {
  it("rolls a parent that has no section of its own up to its sub-departments", async () => {
    const { ref } = collegeWithSections(["AIDS", "CSE"]);
    expect(await resolveRollupDepartmentNames(ref, ALL, "Basic Science")).toEqual(["Basic Science", BSM.name, BSP.name]);
  });

  it("leaves a parent that runs its own sections exactly as it was (ECE stays ECE)", async () => {
    const { ref } = collegeWithSections(["ECE", "VLSI"]);
    expect(await resolveRollupDepartmentNames(ref, ALL, "ECE")).toEqual(["ECE"]);
  });

  it("trusts the Principal's explicit flag without asking the sections at all", async () => {
    const flagged = [dept({ id: "p", name: "Parent", hasSubDepartments: true, parentRunsOwnSections: false }),
      dept({ id: "c", name: "Child", parentDepartmentId: "p" })];
    const { ref, reads } = collegeWithSections(["Parent"]); // even a stray section under it
    expect(await resolveRollupDepartmentNames(ref, flagged, "Parent")).toEqual(["Parent", "Child"]);
    expect(reads).toEqual([]);
  });

  it("costs no extra read for a department that cannot be a container", async () => {
    const { ref, reads } = collegeWithSections([]);
    expect(await resolveRollupDepartmentNames(ref, ALL, "CSE")).toEqual(["CSE"]);
    expect(await resolveRollupDepartmentNames(ref, ALL, BSM.name)).toEqual([BSM.name]);
    expect(reads).toEqual([]);
  });

  it("falls back to the explicit flag only when the sections cannot be read", async () => {
    const { ref } = collegeWithSections([], true);
    expect(await resolveRollupDepartmentNames(ref, ALL, "Basic Science")).toEqual(["Basic Science"]);
  });

  it("keeps an unknown name as typed and an empty one empty", async () => {
    const { ref } = collegeWithSections([]);
    expect(await resolveRollupDepartmentNames(ref, ALL, "Stray")).toEqual(["Stray"]);
    expect(await resolveRollupDepartmentNames(ref, ALL, "  ")).toEqual([]);
  });
});

// The reported bug, end to end against the real list query: nobody is filed under
// the parent, so picking it used to return nothing.
describe("student list for a parent pick", () => {
  const roster = () => fakeStudentsCollection([
    { id: "1", data: { name: "A", rollNumber: "1", department: BSM.name, secondaryDepartment: "AIDS", year: 1 } },
    { id: "2", data: { name: "B", rollNumber: "2", department: BSP.name, secondaryDepartment: "CSE", year: 1 } },
    { id: "3", data: { name: "C", rollNumber: "3", department: "AIDS", year: 2 } },
    { id: "4", data: { name: "D", rollNumber: "4", department: "ECE", year: 3 } },
    { id: "5", data: { name: "E", rollNumber: "5", department: "VLSI", year: 3 } },
  ]);
  const base = { page: 1, pageSize: 20, search: "", course: "", year: null as number | null, studentType: "" };

  it("returns every first-year filed under the sub-departments, and nothing from the branches themselves", async () => {
    const { ref } = collegeWithSections(["AIDS", "CSE"]);
    const departments = await resolveRollupDepartmentNames(ref, ALL, "Basic Science");
    const { collection } = roster();
    const { students } = await fetchStudentsPage(collection, { ...base, departments });
    expect(students.map((s) => s.id).sort()).toEqual(["1", "2"]);
  });

  it("narrows a parent pick to one Core Department", async () => {
    const { ref } = collegeWithSections(["AIDS", "CSE"]);
    const departments = await resolveRollupDepartmentNames(ref, ALL, "Basic Science");
    const { collection } = roster();
    const { students } = await fetchStudentsPage(collection, { ...base, departments, coreDepartment: "AIDS" });
    expect(students.map((s) => s.id)).toEqual(["1"]);
  });

  it("still returns only ECE's own students for ECE, as before", async () => {
    const { ref } = collegeWithSections(["ECE", "VLSI"]);
    const departments = await resolveRollupDepartmentNames(ref, ALL, "ECE");
    const { collection } = roster();
    const { students } = await fetchStudentsPage(collection, { ...base, departments });
    expect(students.map((s) => s.id)).toEqual(["4"]);
  });
});
