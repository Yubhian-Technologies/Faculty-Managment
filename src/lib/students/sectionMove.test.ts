import { describe, it, expect } from "vitest";
import { planSectionMove, sectionsAcceptingAll } from "@/lib/students/sectionMove";

describe("sectionsAcceptingAll (bulk-move target list)", () => {
  const sec = (name: string, department: string, year: number, secondaryDepartments?: string[]) => ({ name, department, year, secondaryDepartments });
  const sections = [sec("CSE-A", "CSE", 2), sec("CSE-B", "CSE", 2), sec("IT-A", "IT", 2), sec("CSE-C3", "CSE", 3)];
  const s = (department: string, year: number, secondaryDepartment?: string) => ({ department, year, secondaryDepartment });

  it("offers only same-year sections of the students' department", () => {
    expect(sectionsAcceptingAll(sections, [s("CSE", 2), s("CSE", 2)]).map((x) => x.name)).toEqual(["CSE-A", "CSE-B"]);
  });
  it("offers nothing when the selection spans years or branches, or is empty", () => {
    expect(sectionsAcceptingAll(sections, [s("CSE", 2), s("CSE", 3)])).toEqual([]);
    expect(sectionsAcceptingAll(sections, [s("CSE", 2), s("IT", 2)])).toEqual([]);
    expect(sectionsAcceptingAll(sections, [])).toEqual([]);
  });
  it("routes pre-registered freshmen by their branch", () => {
    const y1 = [sec("BSC-CSE-A", "CSE", 1), sec("BSC-IT-A", "IT", 1)];
    expect(sectionsAcceptingAll(y1, [s("Basic Science", 1, "CSE")]).map((x) => x.name)).toEqual(["BSC-CSE-A"]);
  });
});

const shared = (name: string) => name === "Basic Science";
const opts = { isSharedDept: shared };

const student = (over: Record<string, unknown> = {}) => ({
  name: "S", rollNumber: "R1", department: "CSE", secondaryDepartment: undefined as string | undefined,
  section: "", year: 2, courseId: "c1", ...over,
});
const section = (over: Record<string, unknown> = {}) => ({
  name: "CSE-B", year: 2, department: "CSE", courseId: "c1", courseName: "B.Tech", secondaryDepartments: undefined as string[] | undefined, ...over,
});

describe("planSectionMove", () => {
  it("assigns an unassigned student to a section of their own department", () => {
    const plan = planSectionMove(student(), section(), opts);
    expect(plan).toEqual({
      ok: true,
      historyDepartment: "CSE",
      update: { department: "CSE", secondaryDepartment: null, section: "CSE-B", year: 2, courseId: "c1", course: "B.Tech" },
    });
  });

  it("moves a placed student between sections of the same department", () => {
    const plan = planSectionMove(student({ section: "CSE-A" }), section(), opts);
    expect(plan.ok).toBe(true);
  });

  it("refuses a section of another year (promotion is a different action)", () => {
    const plan = planSectionMove(student({ year: 2 }), section({ year: 3 }), opts);
    expect(plan).toMatchObject({ ok: false });
    expect((plan as { reason: string }).reason).toContain("Year 2");
  });

  it("refuses a section of a different department", () => {
    const plan = planSectionMove(student(), section({ department: "IT", name: "IT-A" }), opts);
    expect(plan.ok).toBe(false);
    expect((plan as { reason: string }).reason).toContain("doesn't belong to CSE");
  });

  it("refuses the section the student is already in", () => {
    const plan = planSectionMove(student({ section: "CSE-B" }), section(), opts);
    expect(plan).toEqual({ ok: false, reason: "Already in section CSE-B" });
  });

  it("refuses when the roll already exists in the target section (legacy duplicate)", () => {
    const plan = planSectionMove(student({ rollNumber: "r1" }), section(), { ...opts, targetRolls: new Set(["r1"]) });
    expect(plan.ok).toBe(false);
    expect((plan as { reason: string }).reason).toContain("already exists in section CSE-B");
  });

  describe("shared first year", () => {
    const fresher = student({ department: "Basic Science", secondaryDepartment: "IT", year: 1, section: "" });

    it("a Basic Science student goes into their branch's section but keeps the common department", () => {
      const plan = planSectionMove(fresher, section({ name: "BSP-IT-A", year: 1, department: "IT" }), opts);
      expect(plan).toEqual({
        ok: true,
        historyDepartment: "Basic Science",
        update: { section: "BSP-IT-A", year: 1, courseId: "c1", course: "B.Tech" },
      });
    });

    it("refuses another branch's section", () => {
      const plan = planSectionMove(fresher, section({ name: "BSC-CSE-A", year: 1, department: "CSE" }), opts);
      expect(plan.ok).toBe(false);
      expect((plan as { reason: string }).reason).toContain("doesn't belong to IT");
    });

    it("accepts a legacy cross-listed section owned by the common department", () => {
      const plan = planSectionMove(fresher, section({ name: "BS-A", year: 1, department: "Basic Science", secondaryDepartments: ["IT"] }), opts);
      expect(plan.ok).toBe(true);
    });

    it("with several cross-listed branches, uses the student's own; refuses one that isn't listed", () => {
      const target = section({ name: "BS-A", year: 1, department: "Basic Science", secondaryDepartments: ["IT", "CSE"] });
      expect(planSectionMove(fresher, target, opts).ok).toBe(true);
      const ece = student({ department: "Basic Science", secondaryDepartment: "ECE", year: 1 });
      expect(planSectionMove(ece, target, opts).ok).toBe(false);
    });
  });
});
