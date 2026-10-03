import { describe, expect, it } from "vitest";
import { cascadeDeleteSection, findSectionHistory, sectionHistoryMessage } from "./sectionDeletion";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";

const C = "colleges/c1";
const SEC = `${C}/sections/s1`;

function seedSection(fake: FakeFirestore, slots: number, opts: { assignments?: number; drafts?: number } = {}) {
  fake.seed(SEC, { name: "A", department: "CSE", year: 2, courseId: "co1" });
  fake.seed(`${C}/sections/other`, { name: "B" });
  for (let i = 0; i < (opts.assignments ?? 2); i++) fake.seed(`${C}/teachingAssignments/ta${i}`, { sectionId: "s1", facultyId: "f" + i });
  for (let i = 0; i < slots; i++) fake.seed(`${C}/timetableSlots/sl${i}`, { sectionId: "s1", day: "MON", periodNumber: i });
  for (let i = 0; i < (opts.drafts ?? 1); i++) fake.seed(`${C}/timetableDrafts/d${i}`, { sectionId: "s1" });
  // Belongs to a different section - must survive.
  fake.seed(`${C}/teachingAssignments/keep`, { sectionId: "other" });
  fake.seed(`${C}/timetableSlots/keep`, { sectionId: "other" });
}

describe("cascadeDeleteSection", () => {
  it("control: ChunkedBatch (parallel chunks) can delete the section while a child chunk fails, orphaning its children", async () => {
    const fake = new FakeFirestore({ latencyMs: 2 });
    seedSection(fake, 500);
    const db = asFirestore(fake);
    // Fail the chunk holding the first slot - the chunk holding the section still commits.
    fake.failWhen = (ops) => ops.some((o) => o.path === `${C}/timetableSlots/sl0`);
    const slots = await db.collection("colleges").doc("c1").collection("timetableSlots").where("sectionId", "==", "s1").get();
    const batch = new ChunkedBatch(db);
    for (const d of slots.docs) batch.delete(d.ref);
    batch.delete(db.doc(SEC));
    await expect(batch.commit()).rejects.toThrow();
    expect(fake.read(SEC)).toBeUndefined();                       // section is gone...
    expect(fake.list(`${C}/timetableSlots`).length).toBeGreaterThan(1); // ...children are not
  });

  it("deletes the section with all its children and leaves other sections alone (single atomic batch)", async () => {
    const fake = new FakeFirestore({ latencyMs: 2 });
    seedSection(fake, 6);
    const r = await cascadeDeleteSection(asFirestore(fake), "c1", "s1");
    expect(r).toMatchObject({ teachingAssignments: 2, timetableSlots: 6, timetableDrafts: 1, stragglers: 0 });
    expect(fake.read(SEC)).toBeUndefined();
    expect(fake.list(`${C}/timetableSlots`).map((d) => d.id)).toEqual(["keep"]);
    expect(fake.list(`${C}/teachingAssignments`).map((d) => d.id)).toEqual(["keep"]);
    expect(fake.list(`${C}/timetableDrafts`)).toHaveLength(0);
    expect(fake.read(`${C}/sections/other`)).toBeDefined();
  });

  it("a failure in a large cascade leaves the section standing, so it can be retried and finished", async () => {
    const fake = new FakeFirestore({ latencyMs: 2 });
    seedSection(fake, 500);
    const db = asFirestore(fake);
    fake.failWhen = (ops) => ops.some((o) => o.path === `${C}/timetableSlots/sl499`);
    await expect(cascadeDeleteSection(db, "c1", "s1")).rejects.toThrow();
    expect(fake.read(SEC)).toBeDefined(); // never deleted ahead of its children
    fake.failWhen = null;
    const retry = await cascadeDeleteSection(db, "c1", "s1");
    expect(retry.stragglers).toBe(0);
    expect(fake.read(SEC)).toBeUndefined();
    expect(fake.list(`${C}/timetableSlots`).map((d) => d.id)).toEqual(["keep"]);
  });

  it("a batch is never over Firestore's 500-write limit, however many children there are", async () => {
    const fake = new FakeFirestore();
    seedSection(fake, 1200);
    await cascadeDeleteSection(asFirestore(fake), "c1", "s1"); // would throw in the fake if a batch exceeded 500
    expect(fake.list(`${C}/timetableSlots`).map((d) => d.id)).toEqual(["keep"]);
  });

  it("sweeps up a child created while the delete was running", async () => {
    const fake = new FakeFirestore({ latencyMs: 2 });
    seedSection(fake, 3);
    const db = asFirestore(fake);
    let injected = false;
    const originalApply = fake.applyOps.bind(fake);
    fake.applyOps = (ops) => {
      originalApply(ops);
      if (!injected && ops.some((o) => o.path === SEC && o.kind === "delete")) {
        injected = true;
        fake.seed(`${C}/timetableSlots/late`, { sectionId: "s1", day: "TUE", periodNumber: 1 });
      }
    };
    const r = await cascadeDeleteSection(db, "c1", "s1");
    expect(r.stragglers).toBe(1);
    expect(fake.list(`${C}/timetableSlots`).map((d) => d.id)).toEqual(["keep"]);
  });
});

describe("findSectionHistory / sectionHistoryMessage", () => {
  it("is clean for a section that was never taught", async () => {
    const fake = new FakeFirestore();
    seedSection(fake, 2);
    const h = await findSectionHistory(asFirestore(fake), "c1", "s1");
    expect(h).toEqual({ attendanceSessions: false, internalMarks: false });
    expect(sectionHistoryMessage(h)).toBeNull();
  });

  it("blocks on an attendance session recorded against the section id", async () => {
    const fake = new FakeFirestore();
    seedSection(fake, 1);
    fake.seed(`${C}/studentAttendance/x`, { sectionId: "s1", assignmentId: "zzz" });
    const h = await findSectionHistory(asFirestore(fake), "c1", "s1");
    expect(h.attendanceSessions).toBe(true);
    expect(sectionHistoryMessage(h)).toMatch(/attendance records/);
  });

  it("blocks on an OLD attendance session that has no sectionId but names one of the section's assignments", async () => {
    const fake = new FakeFirestore();
    seedSection(fake, 1);
    fake.seed(`${C}/studentAttendance/old`, { assignmentId: "ta1", date: "2025-01-01" });
    expect((await findSectionHistory(asFirestore(fake), "c1", "s1")).attendanceSessions).toBe(true);
  });

  it("blocks on internal marks, found by sectionId or by the assignment-id doc key (older batches)", async () => {
    const a = new FakeFirestore();
    seedSection(a, 1);
    a.seed(`${C}/internalExamMarks/m`, { sectionId: "s1" });
    expect((await findSectionHistory(asFirestore(a), "c1", "s1")).internalMarks).toBe(true);

    const b = new FakeFirestore();
    seedSection(b, 1);
    b.seed(`${C}/internalExamMarks/ta0`, { entries: [] }); // doc id == assignment id, no sectionId field
    const h = await findSectionHistory(asFirestore(b), "c1", "s1");
    expect(h.internalMarks).toBe(true);
    expect(sectionHistoryMessage(h)).toMatch(/internal marks/);
  });

  it("is not tripped by another section's history", async () => {
    const fake = new FakeFirestore();
    seedSection(fake, 1);
    fake.seed(`${C}/studentAttendance/y`, { sectionId: "other", assignmentId: "keep" });
    fake.seed(`${C}/internalExamMarks/keep`, { sectionId: "other" });
    expect(await findSectionHistory(asFirestore(fake), "c1", "s1")).toEqual({ attendanceSessions: false, internalMarks: false });
  });

  it("handles a section with more than 30 assignments (in-query chunking)", async () => {
    const fake = new FakeFirestore();
    seedSection(fake, 1, { assignments: 45 });
    fake.seed(`${C}/studentAttendance/late`, { assignmentId: "ta44" });
    expect((await findSectionHistory(asFirestore(fake), "c1", "s1")).attendanceSessions).toBe(true);
  });
});
