import { describe, expect, it, vi } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";

vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => ({}) }));

import { SubjectMasterService, SubjectRequestError } from "./services/SubjectMasterService";
import { patchItems, runRenameJob } from "./rename";

const C = "colleges/c1";
const row = (over: Record<string, unknown> = {}) => ({ category: "PCC", name: "Data Structures", code: "CS201", lectureHours: 3, tutorialHours: 0, practicalHours: 0, credits: 3, ...over });

async function setup() {
  const fake = new FakeFirestore();
  fake.seed(`${C}/courseCatalog/cat1`, { name: "B.Tech", regulations: ["R20"] });
  fake.seed(`${C}/courses/c-cse`, { name: "B.Tech", catalogId: "cat1", departmentId: "cse", isActive: true });
  const svc = new SubjectMasterService(asFirestore(fake));
  await svc.importMany({ collegeId: "c1", courseId: "c-cse", regulation: "R20", records: [row(), row({ name: "Maths", code: "MA101" })] });
  const ids = [...fake.docs.keys()].filter((k) => k.startsWith(`${C}/subjects/`)).map((k) => k.split("/").pop()!);
  const byCode = (code: string) => ids.find((i) => fake.read(`${C}/subjects/${i}`)!.code === code)!;
  return { fake, svc, ds: byCode("CS201"), ma: byCode("MA101") };
}

describe("rename a subject in use", () => {
  it("renames the subject and every copy, past records included; other subjects untouched", async () => {
    const { fake, svc, ds, ma } = await setup();
    const s = (subjectId: string) => ({ subjectId, subjectName: subjectId === ds ? "Data Structures" : "Maths", subjectCode: subjectId === ds ? "CS201" : "MA101" });
    fake.seed(`${C}/subjectSemesterAssignments/a1`, { ...s(ds), semester: 3 });
    fake.seed(`${C}/teachingAssignments/t1`, { ...s(ds), facultyId: "f1" });
    fake.seed(`${C}/teachingAssignments/t2`, { ...s(ma), facultyId: "f1" });
    for (let i = 0; i < 5; i++) fake.seed(`${C}/studentAttendance/sess${i}`, { ...s(ds), date: `2026-07-0${i + 1}` });
    fake.seed(`${C}/timetableSlots/x1`, { subjectId: ds, subjectName: "Data Structures" }); // no code stored - none added
    fake.seed(`${C}/midTimetables/m1`, { slots: [{ ...s(ds), date: "2026-09-01" }, { ...s(ma), date: "2026-09-02" }] });
    fake.seed(`${C}/examMarksCategories/k1`, { subjectIds: [ds], subjects: [{ id: ds, code: "CS201", name: "Data Structures", regulation: "R20" }] });
    fake.seed(`${C}/semesterResultBatches/b1`, { courseIds: ["c-cse"] });
    fake.seed(`${C}/semesterResults/b1_st1`, { batchId: "b1", subjects: [{ ...s(ds), grade: "A" }, { ...s(ma), grade: "B" }] });
    fake.seed(`${C}/students/st1`, { courseId: "c-cse" });
    fake.seed(`${C}/students/st1/mentoringSemesters/3`, { subjects: [{ subjectId: ds, code: "CS201", name: "Data Structures", credits: 3 }] });
    fake.seed(`${C}/midBankSubjectSplits/${ds}`, { subjectName: "Data Structures", subjectCode: "CS201" });

    const preview = await svc.beginRename({ collegeId: "c1", id: ds, name: "Data Structures and Algorithms", code: "CS201A", preview: true, actor: { uid: "u", name: "Dean" } });
    expect(preview.preview).toBe(true);
    if (preview.preview) {
      expect(preview.counts.find((c) => c.key === "attendance")!.count).toBe(5);
      expect(preview.counts.find((c) => c.key === "teaching")!.count).toBe(1);
    }
    expect(fake.read(`${C}/subjects/${ds}`)!.code).toBe("CS201"); // preview writes nothing

    const r = await svc.beginRename({ collegeId: "c1", id: ds, name: "Data Structures and Algorithms", code: "CS201A", actor: { uid: "u", name: "Dean" } });
    if (r.preview) throw new Error("expected a job");
    const db = asFirestore(fake);
    let job = await runRenameJob(db, "c1", r.jobId, 0); // no time left: does one step, saves where it is, stops
    expect(job.status).toBe("RUNNING");
    expect(job.stepIndex).toBe(1);
    for (let i = 0; i < 40 && job.status !== "DONE"; i++) job = await runRenameJob(db, "c1", r.jobId);
    expect(job.status).toBe("DONE");

    const subj = fake.read(`${C}/subjects/${ds}`)!;
    expect(subj).toMatchObject({ name: "Data Structures and Algorithms", code: "CS201A" });
    expect(subj.previousCodes).toEqual(["CS201"]);
    const want = { subjectName: "Data Structures and Algorithms", subjectCode: "CS201A" };
    expect(fake.read(`${C}/subjectSemesterAssignments/a1`)).toMatchObject(want);
    expect(fake.read(`${C}/teachingAssignments/t1`)).toMatchObject(want);
    expect(fake.read(`${C}/teachingAssignments/t2`)).toMatchObject({ subjectName: "Maths", subjectCode: "MA101" });
    for (let i = 0; i < 5; i++) expect(fake.read(`${C}/studentAttendance/sess${i}`)).toMatchObject(want);
    expect(fake.read(`${C}/timetableSlots/x1`)).toEqual({ subjectId: ds, subjectName: "Data Structures and Algorithms" });
    const slots = fake.read(`${C}/midTimetables/m1`)!.slots as { subjectName: string }[];
    expect(slots.map((x) => x.subjectName)).toEqual(["Data Structures and Algorithms", "Maths"]);
    expect((fake.read(`${C}/examMarksCategories/k1`)!.subjects as { code: string }[])[0].code).toBe("CS201A");
    const res = fake.read(`${C}/semesterResults/b1_st1`)!.subjects as { subjectCode: string; grade: string }[];
    expect(res.map((x) => `${x.subjectCode}:${x.grade}`)).toEqual(["CS201A:A", "MA101:B"]);
    expect((fake.read(`${C}/students/st1/mentoringSemesters/3`)!.subjects as { code: string }[])[0].code).toBe("CS201A");
    expect(fake.read(`${C}/midBankSubjectSplits/${ds}`)).toMatchObject(want);
    expect(fake.read(`${C}/subjects/${ma}`)).toMatchObject({ name: "Maths", code: "MA101" });
  });

  it("refuses a code already used in the course + regulation, and a no-op", async () => {
    const { svc, ds } = await setup();
    await expect(svc.beginRename({ collegeId: "c1", id: ds, name: "Data Structures", code: "MA101", actor: { uid: "u" } })).rejects.toBeInstanceOf(SubjectRequestError);
    await expect(svc.beginRename({ collegeId: "c1", id: ds, name: "Data Structures", code: "CS201", actor: { uid: "u" } })).rejects.toBeInstanceOf(SubjectRequestError);
  });

  it("patchItems renames only the subject's items and only fields that exist", () => {
    const out = patchItems([{ subjectId: "a", subjectName: "X" }, { subjectId: "b", subjectName: "Y", subjectCode: "B1" }], "subjectId", "a", { name: "N", code: "C" }, "subjectName", "subjectCode");
    expect(out).toEqual([{ subjectId: "a", subjectName: "N" }, { subjectId: "b", subjectName: "Y", subjectCode: "B1" }]);
    expect(patchItems([{ subjectId: "b" }], "subjectId", "a", { name: "N", code: "C" }, "subjectName", "subjectCode")).toBeNull();
  });
});
