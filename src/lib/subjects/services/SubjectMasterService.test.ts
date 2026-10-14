import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";

vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => ({}) }));

import { MASTER_IMPORT_MAX_ROWS, SubjectMasterService, SubjectRequestError } from "./SubjectMasterService";

const C = "colleges/c1";
const row = (over: Record<string, unknown> = {}) => ({
  category: "PCC", name: "Data Structures", code: "CS201", lectureHours: 3, tutorialHours: 0, practicalHours: 0, credits: 3, ...over,
});

let fake: FakeFirestore;
let svc: SubjectMasterService;
const subjects = () => [...fake.docs.keys()].filter((k) => k.startsWith(`${C}/subjects/`));
const keys = () => [...fake.docs.keys()].filter((k) => k.startsWith(`${C}/subjectKeys/`));

function seed(f: FakeFirestore) {
  f.seed(`${C}/courseCatalog/cat1`, { name: "B.Tech", regulations: ["R20", "R23"] });
  f.seed(`${C}/courses/c-cse`, { name: "B.Tech", catalogId: "cat1", departmentId: "cse", isActive: true });
  f.seed(`${C}/courses/c-it`, { name: "B.Tech", catalogId: "cat1", departmentId: "it", isActive: true });
}

beforeEach(() => {
  fake = new FakeFirestore();
  seed(fake);
  svc = new SubjectMasterService(asFirestore(fake));
});

describe("SubjectMasterService.importMany", () => {
  it("saves every row with both locks, in one go", async () => {
    const r = await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row(), row({ name: "Algorithms", code: "CS202" })] });
    expect(r.failed).toEqual([]);
    expect(r.created).toBe(2);
    expect(subjects()).toHaveLength(2);
    expect(keys()).toHaveLength(4); // code + name lock per subject
    const doc = fake.read(subjects()[0])!;
    expect(doc.catalogId).toBe("cat1");
    expect(doc.hoursPerWeek).toBe(3);
  });

  it("a dry run writes nothing", async () => {
    const r = await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row()], dryRun: true });
    expect(r.created).toBe(1);
    expect(subjects()).toHaveLength(0);
    expect(keys()).toHaveLength(0);
  });

  it("refuses a code that is already used - and saves nothing from the file", async () => {
    await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row()] });
    const r = await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row({ name: "Other", code: "CS300" }), row({ name: "Different Name" })] });
    expect(r.created).toBe(0);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].error).toMatch(/Code CS201 is already used/);
    expect(subjects()).toHaveLength(1);
  });

  it("refuses a name that is already used under a different code (case and spacing ignored)", async () => {
    await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row()] });
    const r = await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row({ code: "CS999", name: "  data   STRUCTURES " })] });
    expect(r.failed[0].error).toMatch(/name "Data Structures" is already used by code CS201/i);
    expect(subjects()).toHaveLength(1);
  });

  it("catches repeats inside the file", async () => {
    const r = await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row(), row({ name: "Algorithms" }), row({ code: "CS9" })] });
    expect(r.created).toBe(0);
    expect(r.failed.map((f) => f.row)).toEqual([3, 4]);
    expect(subjects()).toHaveLength(0);
  });

  it("treats the sibling department's Course doc as the same course", async () => {
    await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row()] });
    const r = await svc.importMany({ collegeId: "c1", courseId: "c-it", regulation: "R20", records: [row()] });
    expect(r.created).toBe(0);
    expect(r.failed[0].error).toMatch(/already used/);
  });

  it("allows the same code and name in another regulation", async () => {
    await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row()] });
    const r = await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R23", records: [row()] });
    expect(r.created).toBe(1);
    expect(subjects()).toHaveLength(2);
  });

  it("never invents credits or turns an unreadable number into 0", async () => {
    const missing = await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row({ credits: "" })] });
    expect(missing.failed[0].error).toMatch(/Credits are required/);
    const garbage = await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row({ credits: "three" })] });
    expect(garbage.failed[0].error).toMatch(/Credits must be a number/);
    const negative = await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row({ lectureHours: -1 })] });
    expect(negative.failed[0].error).toMatch(/between 0 and 40/);
    expect(subjects()).toHaveLength(0);
    // an explicit dash / 0 is a real "none"
    const none = await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row({ credits: "-", practicalHours: "-" })] });
    expect(none.created).toBe(1);
  });

  it("derives weekly hours from L+T+P only", async () => {
    await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row({ lectureHours: 2, tutorialHours: 1, practicalHours: 2, hoursPerWeek: 99 })] });
    expect(fake.read(subjects()[0])!.hoursPerWeek).toBe(5);
  });

  it("refuses a regulation the course doesn't have, and an oversized file", async () => {
    await expect(svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R99", records: [row()] })).rejects.toThrow(/isn't assigned/);
    const many = Array.from({ length: MASTER_IMPORT_MAX_ROWS + 1 }, (_, i) => row({ code: `C${i}`, name: `N${i}` }));
    await expect(svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: many })).rejects.toBeInstanceOf(SubjectRequestError);
  });

  it("of N concurrent identical imports exactly one wins", async () => {
    const f = new FakeFirestore({ latencyMs: 3, seed: 5 });
    seed(f);
    const s = new SubjectMasterService(asFirestore(f));
    const results = await Promise.all(Array.from({ length: 6 }, () => s.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row()] })));
    expect(results.filter((r) => r.created === 1)).toHaveLength(1);
    expect([...f.docs.keys()].filter((k) => k.startsWith(`${C}/subjects/`))).toHaveLength(1);
  });
});

describe("SubjectMasterService.update", () => {
  async function make(code = "CS201", name = "Data Structures") {
    const r = await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row({ code, name })] });
    return r.createdRows[0].subjectId;
  }
  const instance = (id: string, over: Record<string, unknown> = {}) =>
    fake.seed(`${C}/subjectSemesterAssignments/${id}_cse_3`, {
      subjectId: id, subjectCode: "CS201", subjectName: "Data Structures", departmentId: "cse", semester: 3, year: 2,
      lectureHours: 3, tutorialHours: 0, practicalHours: 0, hoursPerWeek: 3, credits: 3, isActive: true, ...over,
    });

  it("changes code and name while the subject is unassigned, and moves the locks", async () => {
    const id = await make();
    await svc.update({ collegeId: "c1", id, patch: { code: "CS250", name: "Advanced Data Structures" } });
    expect(fake.read(`${C}/subjects/${id}`)!.code).toBe("CS250");
    // the old code and name are free again
    const r = await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row()] });
    expect(r.created).toBe(1);
  });

  it("locks code and name once the subject is assigned", async () => {
    const id = await make();
    instance(id);
    await expect(svc.update({ collegeId: "c1", id, patch: { code: "CS250" } })).rejects.toThrow(/Create a new subject/);
    await expect(svc.update({ collegeId: "c1", id, patch: { name: "Renamed" } })).rejects.toThrow(/Create a new subject/);
    expect(fake.read(`${C}/subjects/${id}`)!.code).toBe("CS201");
    // an unchanged identity is not a change
    await svc.update({ collegeId: "c1", id, patch: { code: "cs201", shortCode: "ds" } });
    expect(fake.read(`${C}/subjects/${id}`)!.shortCode).toBe("DS");
  });

  it("refuses a code or name another subject has", async () => {
    await make("CS201", "Data Structures");
    const other = await make("CS202", "Algorithms");
    await expect(svc.update({ collegeId: "c1", id: other, patch: { code: "CS201" } })).rejects.toMatchObject({ status: 409 });
    await expect(svc.update({ collegeId: "c1", id: other, patch: { name: "data structures" } })).rejects.toMatchObject({ status: 409 });
  });

  it("rejects bad numbers instead of storing them", async () => {
    const id = await make();
    await expect(svc.update({ collegeId: "c1", id, patch: { credits: "abc" } })).rejects.toThrow(/Credits must be a number/);
    await expect(svc.update({ collegeId: "c1", id, patch: { lectureHours: -2 } })).rejects.toThrow(/between 0 and 40/);
    expect(fake.read(`${C}/subjects/${id}`)!.credits).toBe(3);
  });

  it("carries hours and credits to semester copies that follow the master, not to customized ones", async () => {
    const id = await make();
    instance(id);
    fake.seed(`${C}/subjectSemesterAssignments/${id}_it_3`, {
      subjectId: id, departmentId: "it", semester: 3, year: 2, lectureHours: 1, tutorialHours: 0, practicalHours: 0, hoursPerWeek: 1, credits: 2, isCustomized: true, isActive: true,
    });
    const r = await svc.update({ collegeId: "c1", id, patch: { lectureHours: 4, credits: 4 } });
    expect(r.cascaded).toMatchObject({ instances: 2, customizedLeftAlone: 1 });
    expect(fake.read(`${C}/subjectSemesterAssignments/${id}_cse_3`)).toMatchObject({ hoursPerWeek: 4, credits: 4 });
    expect(fake.read(`${C}/subjectSemesterAssignments/${id}_it_3`)).toMatchObject({ hoursPerWeek: 1, credits: 2 });
  });

  it("won't lower hours below periods already placed on a timetable", async () => {
    const id = await make();
    instance(id);
    fake.seed(`${C}/departments/cse`, { name: "CSE" });
    fake.seed(`${C}/teachingAssignments/ta1`, { subjectId: id, departmentId: "cse", department: "CSE", facultyName: "Dr X", sectionName: "A", sectionId: "s1", courseId: "c-cse", year: 2, timetableSemester: 3, hoursPerWeek: 3 });
    for (let i = 0; i < 3; i++) fake.seed(`${C}/timetableSlots/t${i}`, { assignmentId: "ta1", subjectId: id });
    await expect(svc.update({ collegeId: "c1", id, patch: { lectureHours: 1 } })).rejects.toMatchObject({ status: 409 });
    expect(fake.read(`${C}/subjects/${id}`)!.lectureHours).toBe(3);
    expect(fake.read(`${C}/subjectSemesterAssignments/${id}_cse_3`)!.hoursPerWeek).toBe(3);
  });

  it("can't deactivate a subject that is still assigned", async () => {
    const id = await make();
    instance(id);
    await expect(svc.update({ collegeId: "c1", id, patch: { isActive: false } })).rejects.toMatchObject({ status: 409 });
  });
});

describe("SubjectMasterService.remove", () => {
  it("deletes an unused subject and frees its code and name", async () => {
    const r = await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row()] });
    const id = r.createdRows[0].subjectId;
    await svc.remove({ collegeId: "c1", id });
    expect(subjects()).toHaveLength(0);
    expect(keys()).toHaveLength(0);
  });

  it.each(["subjectSemesterAssignments", "teachingAssignments", "timetableSlots"])("refuses while %s still refer to it", async (collection) => {
    const r = await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row()] });
    const id = r.createdRows[0].subjectId;
    fake.seed(`${C}/${collection}/x1`, { subjectId: id });
    await expect(svc.remove({ collegeId: "c1", id })).rejects.toMatchObject({ status: 409 });
    expect(subjects()).toHaveLength(1);
  });
});
