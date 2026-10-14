import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";

vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => ({}) }));

import { ASSIGN_MAX_CODES, parseCodeList, SubjectAssignService, type AssignByCodeRequest } from "./SubjectAssignService";

const C = "colleges/c1";
let fake: FakeFirestore;
let svc: SubjectAssignService;

const instances = () => [...fake.docs.keys()].filter((k) => k.startsWith(`${C}/subjectSemesterAssignments/`));
const req = (over: Partial<AssignByCodeRequest> = {}): AssignByCodeRequest => ({
  collegeId: "c1", courseId: "c-it", departmentId: "it", regulation: "R20", year: 2, semester: 3, codes: ["CS201"], ...over,
});
const subject = (id: string, code: string, over: Record<string, unknown> = {}) =>
  fake.seed(`${C}/subjects/${id}`, {
    collegeId: "c1", courseId: "c-cse", courseName: "B.Tech", regulation: "R20", code, name: `Subject ${code}`, category: "PCC",
    lectureHours: 3, tutorialHours: 0, practicalHours: 0, hoursPerWeek: 3, credits: 3, type: "THEORY", isActive: true, ...over,
  });

beforeEach(() => {
  fake = new FakeFirestore();
  fake.seed(`${C}/courseCatalog/cat1`, { name: "B.Tech", regulations: ["R20", "R23"], regulationBatches: {} });
  fake.seed(`${C}/courses/c-cse`, { name: "B.Tech", catalogId: "cat1", departmentId: "cse", durationYears: 4, isActive: true });
  fake.seed(`${C}/courses/c-it`, { name: "B.Tech", catalogId: "cat1", departmentId: "it", durationYears: 4, isActive: true });
  fake.seed(`${C}/courses/c-other`, { name: "M.Tech", catalogId: "cat2", departmentId: "cse", durationYears: 2, isActive: true });
  fake.seed(`${C}/departments/cse`, { name: "CSE", courseScopes: { cat1: { assignedYears: [2, 3, 4] } } });
  fake.seed(`${C}/departments/it`, { name: "IT", courseScopes: { cat1: { assignedYears: [2, 3, 4] } } });
  fake.seed(`${C}/departments/lonely`, { name: "Lonely" });
  fake.seed(`${C}/courseYearTimings/c-it_year2`, { semesters: [{ semester: 3 }, { semester: 4 }] });
  subject("s1", "CS201");
  subject("s2", "CS202");
  subject("s3", "CS203");
  svc = new SubjectAssignService(asFirestore(fake));
});

describe("parseCodeList", () => {
  it("accepts newlines, commas, semicolons and spaces, upper-cases, and drops blanks", () => {
    expect(parseCodeList("cs201, cs202;\n CS203\t\n\n  ")).toEqual(["CS201", "CS202", "CS203"]);
  });
});

describe("SubjectAssignService validate", () => {
  it("reports every code and writes nothing", async () => {
    const r = await svc.run(req({ codes: ["CS201", "NOPE1", "CS202"] }), "validate");
    expect(r.ok).toBe(false);
    expect(r.plan.map((p) => [p.code, p.status])).toEqual([["CS201", "ASSIGN"], ["NOPE1", "NOT_FOUND"], ["CS202", "ASSIGN"]]);
    expect(r.counts).toMatchObject({ toAssign: 2, problems: 1 });
    expect(instances()).toHaveLength(0);
  });

  it("ignores a repeated code but counts it", async () => {
    const r = await svc.run(req({ codes: ["CS201", "cs201", "CS201"] }), "validate");
    expect(r.plan).toHaveLength(1);
    expect(r.counts.repeatedInList).toBe(2);
  });

  it("only finds subjects of THIS catalog course and regulation", async () => {
    subject("m1", "MT100", { courseId: "c-other" });       // another course
    subject("r1", "CS900", { regulation: "R23" });          // another regulation
    const r = await svc.run(req({ codes: ["MT100", "CS900"] }), "validate");
    expect(r.plan.map((p) => p.status)).toEqual(["NOT_FOUND", "NOT_FOUND"]);
  });

  it("flags a deactivated subject and a code carried by two subjects", async () => {
    subject("off", "CS777", { isActive: false });
    subject("d1", "CS888", { name: "Twin A" });
    subject("d2", "CS888", { name: "Twin B" });
    const r = await svc.run(req({ codes: ["CS777", "CS888"] }), "validate");
    expect(r.plan.map((p) => p.status)).toEqual(["INACTIVE", "AMBIGUOUS"]);
  });

  it("marks what is already in the semester", async () => {
    await svc.run(req({ codes: ["CS201"] }), "commit");
    const r = await svc.run(req({ codes: ["CS201", "CS202"] }), "validate");
    expect(r.plan.map((p) => p.status)).toEqual(["ALREADY_ASSIGNED", "ASSIGN"]);
    expect(r.ok).toBe(true);
  });
});

describe("SubjectAssignService commit", () => {
  it("assigns all typed codes, in the typed order, with the server's own department name", async () => {
    const r = await svc.run(req({ codes: ["CS203", "CS201", "CS202"] }), "commit");
    expect(r.ok).toBe(true);
    expect(r.counts.toAssign).toBe(3);
    const doc = (code: string, id: string) => fake.read(`${C}/subjectSemesterAssignments/${id}_it_3`)!;
    expect(doc("CS203", "s3")).toMatchObject({ serialNumber: 1, departmentName: "IT", year: 2, semester: 3, courseId: "c-it", regulation: "R20", subjectCode: "CS203" });
    expect(doc("CS201", "s1").serialNumber).toBe(2);
    expect(doc("CS202", "s2").serialNumber).toBe(3);
  });

  it("assigns nothing at all when any code has a problem", async () => {
    const r = await svc.run(req({ codes: ["CS201", "NOPE1"] }), "commit");
    expect(r.ok).toBe(false);
    expect(instances()).toHaveLength(0);
  });

  it("is a no-op for what is already there - customised copies are not overwritten", async () => {
    await svc.run(req({ codes: ["CS201"] }), "commit");
    const path = `${C}/subjectSemesterAssignments/s1_it_3`;
    fake.seed(path, { ...fake.read(path)!, credits: 9, isCustomized: true, secondaryDepartmentNames: ["CSE"] });
    const r = await svc.run(req({ codes: ["CS201", "CS202"] }), "commit");
    expect(r.counts).toMatchObject({ toAssign: 1, alreadyAssigned: 1 });
    expect(fake.read(path)).toMatchObject({ credits: 9, isCustomized: true, secondaryDepartmentNames: ["CSE"] });
  });

  it("continues the order after what the semester already holds", async () => {
    await svc.run(req({ codes: ["CS201", "CS202"] }), "commit");
    await svc.run(req({ codes: ["CS203"] }), "commit");
    expect(fake.read(`${C}/subjectSemesterAssignments/s3_it_3`)!.serialNumber).toBe(3);
  });

  it("two simultaneous assigns of the same code produce one instance, never an overwrite", async () => {
    const f = new FakeFirestore({ latencyMs: 3, seed: 9 });
    for (const [k, v] of fake.docs) f.seed(k, v.data);
    const s = new SubjectAssignService(asFirestore(f));
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => s.run(req({ codes: ["CS201"] }), "commit")));
    expect([...f.docs.keys()].filter((k) => k.startsWith(`${C}/subjectSemesterAssignments/`))).toHaveLength(1);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
  });
});

describe("SubjectAssignService scope checks", () => {
  it("refuses a department that has no Years Taught", async () => {
    fake.seed(`${C}/courses/c-lonely`, { name: "B.Tech", catalogId: "cat1", departmentId: "lonely", durationYears: 4, isActive: true });
    fake.seed(`${C}/courseYearTimings/c-lonely_year2`, { semesters: [{ semester: 3 }] });
    await expect(svc.run(req({ courseId: "c-lonely", departmentId: "lonely" }), "validate")).rejects.toThrow(/has no Years Taught set/);
  });

  it("refuses a year the department doesn't teach, and a semester that isn't in that year", async () => {
    await expect(svc.run(req({ year: 1 }), "validate")).rejects.toThrow(/isn't scoped to teach/);
    await expect(svc.run(req({ semester: 5 }), "validate")).rejects.toThrow(/doesn't belong to Year 2/);
    await expect(svc.run(req({ year: 3 }), "validate")).rejects.toThrow(/no semesters configured/);
  });

  it("refuses a regulation the course doesn't have, a course another department owns, and an empty or oversized list", async () => {
    await expect(svc.run(req({ regulation: "R99" }), "validate")).rejects.toThrow(/isn't assigned/);
    await expect(svc.run(req({ courseId: "c-cse" }), "validate")).rejects.toThrow(/has its own copy|isn't run by/);
    await expect(svc.run(req({ codes: [] }), "validate")).rejects.toThrow(/at least one subject code/);
    await expect(svc.run(req({ codes: Array.from({ length: ASSIGN_MAX_CODES + 1 }, (_, i) => `C${i}`) }), "validate")).rejects.toThrow(/Maximum/);
  });
});
