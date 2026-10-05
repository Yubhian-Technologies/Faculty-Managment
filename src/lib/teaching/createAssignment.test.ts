import { describe, expect, it } from "vitest";
import { createAssignmentWithSlots, type CreateAssignmentInput } from "./createAssignment";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";

const C = "colleges/c1";
type Over = Partial<CreateAssignmentInput> & { sectionId?: string; facultyId?: string; subjectId?: string; year?: number };
function input(fake: FakeFirestore, over: Over = {}): CreateAssignmentInput {
  const sectionId = over.sectionId ?? "s1";
  const facultyId = over.facultyId ?? "f1";
  const subjectId = over.subjectId ?? "sub1";
  return {
    db: asFirestore(fake), collegeId: "c1",
    assignment: { collegeId: "c1", facultyId, sectionId, subjectId, timetableSemester: null },
    facultyId, facultyName: "Dr F", sectionId, sectionName: "A", subjectId, subjectName: "Maths",
    courseId: "co1", year: over.year ?? 1, department: "CSE", timetableSemester: null,
    isPast: false, isLab: false, slots: [], currentAcademicYear: "2026-27",
    writer: "hod1",
    ...over,
  } as CreateAssignmentInput;
}
const assignmentsOf = (fake: FakeFirestore) => fake.list(`${C}/teachingAssignments`);
const slotsOf = (fake: FakeFirestore) => fake.list(`${C}/timetableSlots`);

describe("createAssignmentWithSlots - concurrency", () => {
  it("control: two plain check-then-write creations both succeed for a single-faculty subject (the bug)", async () => {
    let doubled = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const fake = new FakeFirestore({ latencyMs: 4, seed });
      const db = asFirestore(fake);
      const naive = async (facultyId: string) => {
        const snap = await db.collection(`${C}/teachingAssignments`).where("sectionId", "==", "s1").where("subjectId", "==", "sub1").get();
        if (snap.docs.length >= 1) return;
        await db.collection(`${C}/teachingAssignments`).add({ sectionId: "s1", subjectId: "sub1", facultyId });
      };
      await Promise.all([naive("f1"), naive("f2")]);
      if (assignmentsOf(fake).length === 2) doubled++;
    }
    expect(doubled).toBeGreaterThan(0);
  });

  it("two faculty racing for the same THEORY subject in a section: exactly one is assigned", async () => {
    for (let seed = 1; seed <= 15; seed++) {
      const fake = new FakeFirestore({ latencyMs: 4, seed });
      const [a, b] = await Promise.all([
        createAssignmentWithSlots(input(fake, { facultyId: "f1" })),
        createAssignmentWithSlots(input(fake, { facultyId: "f2" })),
      ]);
      expect(assignmentsOf(fake), `seed ${seed}`).toHaveLength(1);
      expect([a.ok, b.ok].filter(Boolean), `seed ${seed}`).toHaveLength(1);
    }
  });

  it("three faculty racing for a LAB: exactly two are assigned (Batch 1 / Batch 2)", async () => {
    for (let seed = 1; seed <= 15; seed++) {
      const fake = new FakeFirestore({ latencyMs: 4, seed });
      const results = await Promise.all(["f1", "f2", "f3"].map((f) => createAssignmentWithSlots(input(fake, { facultyId: f, isLab: true }))));
      expect(assignmentsOf(fake), `seed ${seed}`).toHaveLength(2);
      expect(results.filter((r) => r.ok), `seed ${seed}`).toHaveLength(2);
    }
  });

  it("the same faculty double-clicking Add creates one assignment", async () => {
    for (let seed = 1; seed <= 15; seed++) {
      const fake = new FakeFirestore({ latencyMs: 4, seed });
      const results = await Promise.all([createAssignmentWithSlots(input(fake)), createAssignmentWithSlots(input(fake))]);
      expect(assignmentsOf(fake), `seed ${seed}`).toHaveLength(1);
      expect(results.filter((r) => !r.ok)[0]).toMatchObject({ error: expect.stringMatching(/already (assigned|)/) });
    }
  });

  it("two subjects racing for the same section cell: exactly one gets it, and the loser leaves NOTHING behind", async () => {
    for (let seed = 1; seed <= 15; seed++) {
      const fake = new FakeFirestore({ latencyMs: 4, seed });
      const slot = [{ day: "MON", periodNumber: 1 }];
      const [a, b] = await Promise.all([
        createAssignmentWithSlots(input(fake, { subjectId: "subA", facultyId: "f1", slots: slot })),
        createAssignmentWithSlots(input(fake, { subjectId: "subB", facultyId: "f2", slots: slot })),
      ]);
      expect([a.ok, b.ok].filter(Boolean), `seed ${seed}`).toHaveLength(1);
      expect(slotsOf(fake), `seed ${seed}`).toHaveLength(1);
      expect(assignmentsOf(fake), `seed ${seed}`).toHaveLength(1); // no half-created assignment for the loser
      const loser = [a, b].find((r) => !r.ok) as { ok: false; error: string };
      expect(loser.error).toMatch(/already has a subject scheduled on MON period 1/);
    }
  });

  it("the same faculty in two sections at the same period number is allowed (no cross-section faculty check, as before)", async () => {
    for (let seed = 1; seed <= 15; seed++) {
      const fake = new FakeFirestore({ latencyMs: 4, seed });
      const [a, b] = await Promise.all([
        createAssignmentWithSlots(input(fake, { sectionId: "s1", subjectId: "subA", year: 1, slots: [{ day: "MON", periodNumber: 3 }] })),
        createAssignmentWithSlots(input(fake, { sectionId: "s2", subjectId: "subB", year: 2, slots: [{ day: "MON", periodNumber: 3 }] })),
      ]);
      expect([a.ok, b.ok], `seed ${seed}`).toEqual([true, true]);
      expect(slotsOf(fake), `seed ${seed}`).toHaveLength(2);
    }
  });
});

describe("createAssignmentWithSlots - behaviour", () => {
  it("creates the assignment and its slots together, stamped with semester/academic year", async () => {
    const fake = new FakeFirestore({ latencyMs: 2 });
    const r = await createAssignmentWithSlots(input(fake, {
      timetableSemester: 2,
      slots: [{ day: "MON", periodNumber: 1, classroom: "R1" }, { day: "TUE", periodNumber: 2, labBatch: "Batch 1" }],
    }));
    expect(r.ok && r.slotIds).toHaveLength(2);
    const slots = slotsOf(fake);
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ sectionId: "s1", facultyId: "f1", semester: 2, academicYear: "2026-27", assignmentId: (r as { id: string }).id });
    expect(slots.find((s) => s.day === "TUE")).toMatchObject({ labBatch: "Batch 1", classroom: null });
  });

  it("allows an explicit split period between two labs, but a repeat of the same cell inside one request is refused", async () => {
    const fake = new FakeFirestore();
    const a = await createAssignmentWithSlots(input(fake, { facultyId: "f1", isLab: true, slots: [{ day: "WED", periodNumber: 1, allowSplit: true }] }));
    const b = await createAssignmentWithSlots(input(fake, { facultyId: "f2", isLab: true, slots: [{ day: "WED", periodNumber: 1, allowSplit: true }] }));
    expect([a.ok, b.ok]).toEqual([true, true]);
    const dup = await createAssignmentWithSlots(input(fake, {
      sectionId: "s9", facultyId: "f9", subjectId: "x",
      slots: [{ day: "THU", periodNumber: 1 }, { day: "THU", periodNumber: 1 }],
    }));
    expect(dup.ok).toBe(false);
  });

  it("a historical (isPast) record skips every conflict check and creates no slots", async () => {
    const fake = new FakeFirestore();
    await createAssignmentWithSlots(input(fake, { isPast: true }));
    const again = await createAssignmentWithSlots(input(fake, { isPast: true, facultyId: "f2", slots: [{ day: "MON", periodNumber: 1 }] }));
    expect(again.ok).toBe(true);
    expect(assignmentsOf(fake)).toHaveLength(2);
    expect(slotsOf(fake)).toHaveLength(0);
  });

  it("a different semester's assignment of the same subject is not a duplicate (unchanged rule)", async () => {
    const fake = new FakeFirestore();
    fake.seed(`${C}/teachingAssignments/old`, { sectionId: "s1", subjectId: "sub1", facultyId: "f1", timetableSemester: 1 });
    const r = await createAssignmentWithSlots(input(fake, { timetableSemester: 2 }));
    expect(r.ok).toBe(true);
  });

  it("a past-record assignment of the same subject does not count against the limit (unchanged rule)", async () => {
    const fake = new FakeFirestore();
    fake.seed(`${C}/teachingAssignments/past`, { sectionId: "s1", subjectId: "sub1", facultyId: "f1", isPast: true });
    expect((await createAssignmentWithSlots(input(fake))).ok).toBe(true);
  });

  it("another section's slot for the same faculty never blocks (clock times are not compared)", async () => {
    const fake = new FakeFirestore();
    fake.seed(`${C}/timetableSlots/existing`, { facultyId: "f1", sectionId: "s3", courseId: "co1", year: 2, day: "MON", periodNumber: 2, academicYear: "2026-27" });
    // Year 1 period 3 (10:40-11:30) overlaps year 2 period 2 (10:20-11:10) on the clock - still allowed.
    expect((await createAssignmentWithSlots(input(fake, { slots: [{ day: "MON", periodNumber: 3 }] }))).ok).toBe(true);
  });

  it("a failed commit leaves no assignment and no slots", async () => {
    const fake = new FakeFirestore();
    fake.failWhen = () => true;
    await expect(createAssignmentWithSlots(input(fake, { slots: [{ day: "MON", periodNumber: 1 }] }))).rejects.toThrow();
    expect(assignmentsOf(fake)).toHaveLength(0);
    expect(slotsOf(fake)).toHaveLength(0);
  });
});
