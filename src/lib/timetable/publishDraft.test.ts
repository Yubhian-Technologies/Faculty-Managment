import { describe, expect, it } from "vitest";
import { publishSectionDraft, publishedSlotId, type PublishInput } from "./publishDraft";
import { timingLookupFrom } from "./facultyOverlap";
import { makeLiveSlotPredicate } from "./liveSlots";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";
import type { CourseYearTiming } from "@/types";

const C = "colleges/c1";
const timing = (year: number, periods: [number, string, string][], extra = {}) =>
  ({
    courseId: "co1", year, collegeStartTime: "09:00", collegeEndTime: "16:00", numberOfPeriods: periods.length,
    periodDurationMinutes: 50, lunchBreak: { afterPeriod: 0, durationMinutes: 0 }, shortBreaks: [],
    periods: periods.map(([period, startTime, endTime]) => ({ period, startTime, endTime })), ...extra,
  }) as unknown as CourseYearTiming;
const Y1 = timing(1, [[1, "09:00", "09:50"], [2, "09:50", "10:40"], [3, "10:40", "11:30"], [4, "11:30", "12:20"]]);
const Y2 = timing(2, [[1, "09:30", "10:20"], [2, "10:20", "11:10"], [3, "11:10", "12:00"]]);
const Y3 = timing(3, [[1, "14:00", "14:50"]]);
const lookup = timingLookupFrom([Y1, Y2, Y3]);

type DS = { assignmentId: string; facultyId: string; facultyName: string; subjectId: string; subjectName: string; subjectType: string; day: string; periodNumber: number };
const ds = (assignmentId: string, facultyId: string, day: string, periodNumber: number, subjectType = "THEORY"): DS => ({
  assignmentId, facultyId, facultyName: facultyId.toUpperCase(), subjectId: "sub_" + assignmentId, subjectName: "S" + assignmentId, subjectType, day, periodNumber,
});

function section(fake: FakeFirestore, id: string, year: number, slots: DS[], extra: Record<string, unknown> = {}) {
  fake.seed(`${C}/sections/${id}`, { name: id.toUpperCase(), department: "CSE", courseId: "co1", year });
  for (const s of slots) fake.seed(`${C}/teachingAssignments/${s.assignmentId}`, { sectionId: id, facultyId: s.facultyId });
  fake.seed(`${C}/timetableDrafts/${id}`, { sectionId: id, courseId: "co1", year, status: "DRAFT", semester: null, slots, ...extra });
}
function liveSlot(fake: FakeFirestore, id: string, over: Record<string, unknown>) {
  fake.seed(`${C}/timetableSlots/${id}`, { courseId: "co1", year: 1, semester: null, academicYear: "2026-27", source: "GENERATED", ...over });
}
function input(fake: FakeFirestore, sectionId: string, year: number): PublishInput {
  return {
    db: asFirestore(fake), collegeId: "c1", draftId: sectionId,
    section: { id: sectionId, department: "CSE", courseId: "co1", year },
    semester: null, currentAcademicYear: "2026-27",
    isLiveSlot: makeLiveSlotPredicate(lookup, "2026-27"), publishedByName: "hod@x", writer: "hod1",
  };
}
const slotsIn = (fake: FakeFirestore, sectionId: string) => fake.list(`${C}/timetableSlots`).filter((s) => s.sectionId === sectionId);

describe("publishSectionDraft", () => {
  it("publishes the draft: GENERATED slots replaced, status flipped, everything stamped", async () => {
    const fake = new FakeFirestore({ latencyMs: 2 });
    section(fake, "s1", 1, [ds("a1", "f1", "MON", 1), ds("a2", "f2", "TUE", 2)]);
    liveSlot(fake, "old1", { sectionId: "s1", facultyId: "f1", assignmentId: "a1", day: "WED", periodNumber: 4 });
    const r = await publishSectionDraft(input(fake, "s1", 1));
    expect(r).toMatchObject({ ok: true, published: 2, replaced: 1, droppedStaleAssignments: 0 });
    const slots = slotsIn(fake, "s1");
    expect(slots.map((s) => `${s.day}:${s.periodNumber}`).sort()).toEqual(["MON:1", "TUE:2"]);
    expect(slots[0]).toMatchObject({ source: "GENERATED", isPinned: false, academicYear: "2026-27", semester: null, department: "CSE", courseId: "co1", year: 1 });
    expect(fake.read(`${C}/timetableDrafts/s1`)).toMatchObject({ status: "PUBLISHED", academicYear: "2026-27", publishedByName: "hod@x", facultyIds: ["f1", "f2"] });
  });

  it("keeps pinned slots, other sections, and other sessions'/semesters' history untouched", async () => {
    const fake = new FakeFirestore();
    section(fake, "s1", 1, [ds("a1", "f1", "MON", 1)]);
    liveSlot(fake, "pin", { sectionId: "s1", facultyId: "f9", assignmentId: "zz", day: "FRI", periodNumber: 1, source: "MANUAL" });
    liveSlot(fake, "legacy", { sectionId: "s1", facultyId: "f9", assignmentId: "zz", day: "FRI", periodNumber: 2, source: undefined });
    liveSlot(fake, "otherSec", { sectionId: "s7", facultyId: "f7", assignmentId: "q", day: "MON", periodNumber: 1 });
    liveSlot(fake, "lastYear", { sectionId: "s1", facultyId: "f1", assignmentId: "a1", day: "THU", periodNumber: 1, academicYear: "2025-26" });
    await publishSectionDraft(input(fake, "s1", 1));
    const ids = fake.list(`${C}/timetableSlots`).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["pin", "legacy", "otherSec", "lastYear"]));
    expect(ids).toHaveLength(5); // + the one published slot
  });

  it("slot ids are deterministic: republishing an unchanged cell reuses its id", async () => {
    const fake = new FakeFirestore();
    section(fake, "s1", 1, [ds("a1", "f1", "MON", 1)]);
    const first = await publishSectionDraft(input(fake, "s1", 1));
    const again = await publishSectionDraft(input(fake, "s1", 1));
    expect(first.ok && again.ok).toBe(true);
    expect((first as { slotIds: string[] }).slotIds).toEqual((again as { slotIds: string[] }).slotIds);
    expect(slotsIn(fake, "s1")).toHaveLength(1); // not duplicated
    expect((first as { slotIds: string[] }).slotIds[0]).toBe(publishedSlotId("s1", "2026-27", null, { day: "MON", periodNumber: 1, assignmentId: "a1" }));
  });

  it("a failed commit changes nothing: old slots intact, draft still a draft", async () => {
    const fake = new FakeFirestore();
    section(fake, "s1", 1, [ds("a1", "f1", "MON", 1)]);
    liveSlot(fake, "old1", { sectionId: "s1", facultyId: "f1", assignmentId: "a1", day: "WED", periodNumber: 4 });
    fake.failWhen = () => true;
    await expect(publishSectionDraft(input(fake, "s1", 1))).rejects.toThrow();
    expect(slotsIn(fake, "s1").map((s) => s.id)).toEqual(["old1"]);
    expect(fake.read(`${C}/timetableDrafts/s1`)!.status).toBe("DRAFT");
  });

  it("drops placements whose teaching assignment is gone, and refuses when nothing is left", async () => {
    const fake = new FakeFirestore();
    section(fake, "s1", 1, [ds("a1", "f1", "MON", 1)]);
    fake.seed(`${C}/timetableDrafts/s1`, { sectionId: "s1", courseId: "co1", year: 1, status: "DRAFT", slots: [ds("a1", "f1", "MON", 1), ds("gone", "f3", "TUE", 1)] });
    const r = await publishSectionDraft(input(fake, "s1", 1));
    expect(r).toMatchObject({ ok: true, published: 1, droppedStaleAssignments: 1 });

    const none = new FakeFirestore();
    none.seed(`${C}/timetableDrafts/s1`, { sectionId: "s1", status: "DRAFT", slots: [ds("gone", "f3", "TUE", 1)] });
    expect(await publishSectionDraft(input(none, "s1", 1))).toMatchObject({ ok: false, status: 400 });
  });

  it("reports a missing or empty draft with the same statuses as before", async () => {
    const fake = new FakeFirestore();
    expect(await publishSectionDraft(input(fake, "s1", 1))).toMatchObject({ ok: false, status: 404, error: "No draft to publish" });
    fake.seed(`${C}/timetableDrafts/s1`, { sectionId: "s1", status: "DRAFT", slots: [] });
    expect(await publishSectionDraft(input(fake, "s1", 1))).toMatchObject({ ok: false, status: 400, error: "This draft has no slots to publish" });
  });
});

describe("publishSectionDraft - section cells are re-validated (F-23)", () => {
  it("refuses a draft placement on a cell that has since been pinned", async () => {
    const fake = new FakeFirestore();
    section(fake, "s1", 1, [ds("a1", "f1", "MON", 1)]);
    liveSlot(fake, "pin", { sectionId: "s1", facultyId: "f9", assignmentId: "zz", day: "MON", periodNumber: 1, source: "MANUAL" });
    const r = await publishSectionDraft(input(fake, "s1", 1));
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect((r as { issues: string[] }).issues[0]).toMatch(/MON period 1 now holds a pinned slot/);
    expect(slotsIn(fake, "s1").map((s) => s.id)).toEqual(["pin"]);
  });

  it("refuses two theory subjects in one cell, allows exactly two labs", async () => {
    const theory = new FakeFirestore();
    section(theory, "s1", 1, [ds("a1", "f1", "MON", 1), ds("a2", "f2", "MON", 1)]);
    expect(await publishSectionDraft(input(theory, "s1", 1))).toMatchObject({ ok: false, status: 409 });

    const labs = new FakeFirestore();
    section(labs, "s1", 1, [ds("a1", "f1", "MON", 1, "PRACTICAL"), ds("a2", "f2", "MON", 1, "PRACTICAL")]);
    expect(await publishSectionDraft(input(labs, "s1", 1))).toMatchObject({ ok: true, published: 2 });

    const three = new FakeFirestore();
    section(three, "s1", 1, [ds("a1", "f1", "MON", 1, "PRACTICAL"), ds("a2", "f2", "MON", 1, "PRACTICAL"), ds("a3", "f3", "MON", 1, "PRACTICAL")]);
    expect(await publishSectionDraft(input(three, "s1", 1))).toMatchObject({ ok: false, status: 409 });

    const mixed = new FakeFirestore();
    section(mixed, "s1", 1, [ds("a1", "f1", "MON", 1, "PRACTICAL"), ds("a2", "f2", "MON", 1, "THEORY")]);
    expect(await publishSectionDraft(input(mixed, "s1", 1))).toMatchObject({ ok: false, status: 409 });
  });

  it("also allows exactly two non-teaching subjects sharing a cell, but not mixed with a lab", async () => {
    const nonTeaching = new FakeFirestore();
    section(nonTeaching, "s1", 1, [ds("a1", "f1", "MON", 1, "NON_TEACHING"), ds("a2", "f2", "MON", 1, "NON_TEACHING")]);
    expect(await publishSectionDraft(input(nonTeaching, "s1", 1))).toMatchObject({ ok: true, published: 2 });

    const mixedWithLab = new FakeFirestore();
    section(mixedWithLab, "s1", 1, [ds("a1", "f1", "MON", 1, "NON_TEACHING"), ds("a2", "f2", "MON", 1, "PRACTICAL")]);
    expect(await publishSectionDraft(input(mixedWithLab, "s1", 1))).toMatchObject({ ok: false, status: 409 });
  });
});

describe("publishSectionDraft - faculty in two sections at the same time is allowed", () => {
  it("publishes the same faculty, same day, same period NUMBER in another section", async () => {
    const fake = new FakeFirestore();
    section(fake, "s1", 1, [ds("a1", "f1", "MON", 2)]);
    liveSlot(fake, "other", { sectionId: "s2", courseId: "co1", year: 2, facultyId: "f1", assignmentId: "x", day: "MON", periodNumber: 2 });
    expect(await publishSectionDraft(input(fake, "s1", 1))).toMatchObject({ ok: true, published: 1 });
  });
});

describe("publishSectionDraft - concurrency (F-21)", () => {
  it("control: a plain read-check-write publish double-books the faculty when two sections publish together", async () => {
    let doubled = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const fake = new FakeFirestore({ latencyMs: 4, seed });
      const db = asFirestore(fake);
      const naive = async (sectionId: string, year: number, period: number) => {
        const live = await db.collection(`${C}/timetableSlots`).where("facultyId", "==", "f1").get();
        if (live.docs.length > 0) return;
        await db.collection(`${C}/timetableSlots`).add({ sectionId, year, facultyId: "f1", periodNumber: period });
      };
      await Promise.all([naive("s1", 1, 3), naive("s2", 2, 2)]);
      if (fake.list(`${C}/timetableSlots`).length === 2) doubled++;
    }
    expect(doubled).toBeGreaterThan(0);
  });

  it("two sections publishing the same faculty in the same period together: both go live", async () => {
    for (let seed = 1; seed <= 15; seed++) {
      const fake = new FakeFirestore({ latencyMs: 4, seed });
      section(fake, "s1", 1, [ds("a1", "f1", "MON", 2)]);
      section(fake, "s2", 2, [ds("a2", "f1", "MON", 2)]);
      const [a, b] = await Promise.all([publishSectionDraft(input(fake, "s1", 1)), publishSectionDraft(input(fake, "s2", 2))]);
      expect(a.ok && b.ok, `seed ${seed}`).toBe(true);
      expect(fake.list(`${C}/timetableSlots`), `seed ${seed}`).toHaveLength(2);
    }
  });

  it("publishing the same section twice at once leaves one consistent timetable", async () => {
    for (let seed = 1; seed <= 10; seed++) {
      const fake = new FakeFirestore({ latencyMs: 4, seed });
      section(fake, "s1", 1, [ds("a1", "f1", "MON", 1), ds("a2", "f2", "TUE", 1)]);
      await Promise.all([publishSectionDraft(input(fake, "s1", 1)), publishSectionDraft(input(fake, "s1", 1))]);
      expect(slotsIn(fake, "s1"), `seed ${seed}`).toHaveLength(2);
    }
  });

  it("a hand edit landing on the draft while it is being published never publishes a half-old draft", async () => {
    for (let seed = 1; seed <= 10; seed++) {
      const fake = new FakeFirestore({ latencyMs: 4, seed });
      section(fake, "s1", 1, [ds("a1", "f1", "MON", 1)]);
      fake.seed(`${C}/teachingAssignments/a2`, { sectionId: "s1", facultyId: "f2" });
      const edit = fake.runTransaction(async (tx) => {
        const ref = fake.doc(`${C}/timetableDrafts/s1`);
        const snap = await tx.get(ref);
        const slots = [...(snap.data()!.slots as DS[]), ds("a2", "f2", "TUE", 2)];
        tx.set(ref, { slots, status: "DRAFT", facultyIds: ["f1", "f2"] }, { merge: true });
      });
      const pub = publishSectionDraft(input(fake, "s1", 1));
      await Promise.all([edit, pub]);
      // Whatever order they ran in, the live slots must match the slots of a draft state that existed.
      const live = slotsIn(fake, "s1").map((s) => `${s.day}:${s.periodNumber}`).sort();
      expect([["MON:1"], ["MON:1", "TUE:2"]], `seed ${seed}: ${live}`).toContainEqual(live);
    }
  });
});
