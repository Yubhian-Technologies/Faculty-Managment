import { describe, expect, it } from "vitest";
import { deleteAssignmentWithSlots } from "./deleteAssignment";
import { createAssignmentWithSlots } from "./createAssignment";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";

const C = "colleges/c1";

describe("deleteAssignmentWithSlots", () => {
  it("removes the assignment and only its own slots", async () => {
    const fake = new FakeFirestore({ latencyMs: 2 });
    fake.seed(`${C}/teachingAssignments/a1`, { sectionId: "s1", facultyId: "f1", subjectName: "Maths" });
    fake.seed(`${C}/teachingAssignments/a2`, { sectionId: "s1", facultyId: "f2" });
    fake.seed(`${C}/timetableSlots/x1`, { assignmentId: "a1", sectionId: "s1" });
    fake.seed(`${C}/timetableSlots/x2`, { assignmentId: "a1", sectionId: "s1" });
    fake.seed(`${C}/timetableSlots/y1`, { assignmentId: "a2", sectionId: "s1" });
    const r = await deleteAssignmentWithSlots(asFirestore(fake), "c1", "a1", "hod1");
    expect(r).toMatchObject({ id: "a1", slotCount: 2, data: { subjectName: "Maths" } });
    expect(fake.list(`${C}/teachingAssignments`).map((d) => d.id)).toEqual(["a2"]);
    expect(fake.list(`${C}/timetableSlots`).map((d) => d.id)).toEqual(["y1"]);
  });

  it("is idempotent: deleting something already gone returns null and changes nothing", async () => {
    const fake = new FakeFirestore();
    fake.seed(`${C}/teachingAssignments/a2`, { sectionId: "s1" });
    expect(await deleteAssignmentWithSlots(asFirestore(fake), "c1", "ghost", "hod1")).toBeNull();
    expect(fake.list(`${C}/teachingAssignments`)).toHaveLength(1);
  });

  it("a double-click delete removes it once; the second call finds nothing", async () => {
    const fake = new FakeFirestore({ latencyMs: 4, seed: 3 });
    fake.seed(`${C}/teachingAssignments/a1`, { sectionId: "s1" });
    fake.seed(`${C}/timetableSlots/x1`, { assignmentId: "a1" });
    const [a, b] = await Promise.all([
      deleteAssignmentWithSlots(asFirestore(fake), "c1", "a1", "h"),
      deleteAssignmentWithSlots(asFirestore(fake), "c1", "a1", "h"),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(fake.list(`${C}/timetableSlots`)).toHaveLength(0);
  });

  it("a failed commit removes neither the assignment nor any slot", async () => {
    const fake = new FakeFirestore();
    fake.seed(`${C}/teachingAssignments/a1`, { sectionId: "s1" });
    fake.seed(`${C}/timetableSlots/x1`, { assignmentId: "a1" });
    fake.failWhen = () => true;
    await expect(deleteAssignmentWithSlots(asFirestore(fake), "c1", "a1", "h")).rejects.toThrow();
    expect(fake.list(`${C}/teachingAssignments`)).toHaveLength(1);
    expect(fake.list(`${C}/timetableSlots`)).toHaveLength(1);
  });

  it("a slot being added to the assignment's section while it is deleted never survives as an orphan", async () => {
    for (let seed = 1; seed <= 15; seed++) {
      const fake = new FakeFirestore({ latencyMs: 4, seed });
      fake.seed(`${C}/teachingAssignments/a1`, { sectionId: "s1", facultyId: "f1", subjectId: "sub1" });
      await Promise.allSettled([
        deleteAssignmentWithSlots(asFirestore(fake), "c1", "a1", "h"),
        // A new assignment in the SAME section, staging a slot - contends on the same section guard.
        createAssignmentWithSlots({
          db: asFirestore(fake), collegeId: "c1", assignment: { sectionId: "s1", facultyId: "f2", subjectId: "sub2" },
          facultyId: "f2", facultyName: "F2", sectionId: "s1", sectionName: "A", subjectId: "sub2", subjectName: "S2",
          courseId: "co1", year: 1, department: "CSE", timetableSemester: null, isPast: false, isLab: false,
          slots: [{ day: "MON", periodNumber: 1 }], currentAcademicYear: "2026-27",
          writer: "h",
        }),
      ]);
      const assignmentIds = new Set(fake.list(`${C}/teachingAssignments`).map((d) => d.id));
      for (const slot of fake.list(`${C}/timetableSlots`)) {
        expect(assignmentIds.has(slot.assignmentId as string), `seed ${seed}: orphan slot ${slot.id}`).toBe(true);
      }
    }
  });
});
