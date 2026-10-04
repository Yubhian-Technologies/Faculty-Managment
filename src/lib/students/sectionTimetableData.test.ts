import { beforeEach, describe, expect, it } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";
import { clearSectionTimetableCache, getSectionTimetableData } from "./sectionTimetableData";
import type { Section } from "@/types";

const C = "colleges/c1";
const section = { id: "sec1", courseId: "co1", year: 2 } as unknown as Section & { id: string };

function seeded() {
  const fake = new FakeFirestore();
  fake.seed(`${C}/courses/co1`, { name: "B.Tech" });
  fake.seed(`${C}/courseYearTimings/co1_y2`, { courseId: "co1", year: 2 });
  fake.seed(`${C}/timetableSlots/t1`, { sectionId: "sec1", day: "MON", periodNumber: 1 });
  fake.seed(`${C}/timetableSlots/t2`, { sectionId: "other", day: "MON", periodNumber: 1 });
  fake.seed(`${C}/teachingAssignments/a1`, { sectionId: "sec1" });
  fake.seed(`${C}/departments/d1`, { name: "CSE" });
  fake.seed(`${C}/subjects/s1`, { courseId: "co1", code: "CS1" });
  fake.seed(`${C}/subjects/s2`, { courseId: "other", code: "X" });
  return fake;
}

describe("getSectionTimetableData", () => {
  beforeEach(() => clearSectionTimetableCache());

  it("returns only this section's slots/assignments and this course's subjects", async () => {
    const data = await getSectionTimetableData(asFirestore(seeded()), "c1", section);
    expect(data.course?.name).toBe("B.Tech");
    expect(data.slots.map((s) => s.id)).toEqual(["t1"]);
    expect(data.assignments.map((a) => a.id)).toEqual(["a1"]);
    expect(data.subjects.map((s) => s.id)).toEqual(["s1"]);
    expect(data.departments).toHaveLength(1);
  });

  it("60 students of one section cost one load, not 60", async () => {
    const fake = seeded();
    const db = asFirestore(fake);
    await Promise.all(Array.from({ length: 60 }, () => getSectionTimetableData(db, "c1", section)));
    const afterFirstBurst = fake.readCount;
    await Promise.all(Array.from({ length: 60 }, () => getSectionTimetableData(db, "c1", section)));
    expect(fake.readCount).toBe(afterFirstBurst);
    clearSectionTimetableCache();
    const single = seeded();
    await getSectionTimetableData(asFirestore(single), "c1", section);
    expect(afterFirstBurst).toBe(single.readCount);
  });

  it("different sections do not share an entry", async () => {
    const fake = seeded();
    const db = asFirestore(fake);
    await getSectionTimetableData(db, "c1", section);
    const before = fake.readCount;
    await getSectionTimetableData(db, "c1", { ...section, id: "other" });
    expect(fake.readCount).toBeGreaterThan(before);
  });
});
