import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { denominatorNumbers, loadNotPostedIndex, parseDenominatorParam, resolveDenominatorMode } from "./heldDenominator";
import { windowForAcademicYear, type AcademicYearConfig } from "./academicYearWindow";
import { sortStudentsForList } from "@/lib/students/listOrder";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";

const C = "colleges/c1";
// Thursday 2026-10-08, 15:00 IST.
const NOW = new Date(Date.UTC(2026, 9, 8, 9, 30, 0));
const cfg: AcademicYearConfig = { start: { month: 4, day: 1 }, end: { month: 3, day: 31 }, currentLabel: "2026-27" };
const current = windowForAcademicYear("2026-27", cfg)!;
const published = Timestamp.fromDate(new Date(Date.UTC(2026, 8, 1, 6, 0, 0))); // 2026-09-01 IST

function seed(fake: FakeFirestore, over: { holidays?: string[]; academicYear?: string } = {}) {
  fake.seed(`${C}/courseYearTimings/co1_year1`, {
    courseId: "co1", year: 1, collegeStartTime: "09:00", numberOfPeriods: 2, periodDurationMinutes: 50,
    lunchBreak: { afterPeriod: 0, durationMinutes: 0 }, shortBreaks: [],
    periods: [{ period: 1, startTime: "09:00", endTime: "09:50" }, { period: 2, startTime: "09:50", endTime: "10:40" }],
  });
  const slot = (id: string, over2: Record<string, unknown>) =>
    fake.seed(`${C}/timetableSlots/${id}`, {
      sectionId: "s1", courseId: "co1", year: 1, semester: null, academicYear: over.academicYear ?? "2026-27", createdAt: published, ...over2,
    });
  slot("m", { assignmentId: "a1", subjectId: "maths", subjectName: "Maths", day: "MON", periodNumber: 1 });
  slot("p", { assignmentId: "a2", subjectId: "physics", subjectName: "Physics", day: "TUE", periodNumber: 1 });
  slot("l1", { assignmentId: "a3", subjectId: "chem-lab", subjectName: "Chem Lab", day: "MON", periodNumber: 2, labBatch: "Batch 1" });
  slot("l2", { assignmentId: "a4", subjectId: "phy-lab", subjectName: "Phy Lab", day: "MON", periodNumber: 2, labBatch: "Batch 2" });
  (over.holidays ?? []).forEach((d, i) => fake.seed(`${C}/holidays/h${i}`, { date: Timestamp.fromDate(new Date(`${d}T00:00:00+05:30`)), name: "Holiday" }));
}

const args = (fake: FakeFirestore, over: Record<string, unknown> = {}) => ({
  db: asFirestore(fake), collegeId: "c1", section: { id: "s1", courseId: "co1", year: 1 },
  from: "2026-09-01", to: "2026-10-08", window: current, requestedSemester: null,
  submittedSessions: [] as { assignmentId: string; date: string; periodNumber?: number | null }[], now: NOW, ...over,
});
const counts = (m: Map<string, number>) => Object.fromEntries([...m.entries()].sort());

describe("loadNotPostedIndex", () => {
  it("counts the published periods nobody posted, per subject, on teaching days only", async () => {
    const fake = new FakeFirestore();
    seed(fake, { holidays: ["2026-09-14"] }); // a Monday
    const r = await loadNotPostedIndex(args(fake, {
      submittedSessions: [{ assignmentId: "a1", date: "2026-10-05", periodNumber: 1 }], // Oct 5 maths was posted
    }));
    // Mondays Sep 7, 14(holiday), 21, 28, Oct 5 -> 4 teaching Mondays; maths posted once -> 3 not posted. Tuesdays Sep 1,8,15,22,29, Oct 6 -> 6.
    expect(counts(r.index.forStudent({}))).toEqual({ maths: 3, physics: 6 });
    expect(r.unavailable).toBeUndefined();
  });

  it("a split lab period only counts against the students of that batch", async () => {
    const fake = new FakeFirestore();
    seed(fake);
    const r = await loadNotPostedIndex(args(fake));
    expect(counts(r.index.forStudent({ labBatch: "batch 1" }))).toEqual({ "chem-lab": 5, maths: 5, physics: 6 });
    expect(counts(r.index.forStudent({ labBatch: "Batch 2" }))).toEqual({ maths: 5, physics: 6, "phy-lab": 5 });
    expect(counts(r.index.forStudent({}))).toEqual({ maths: 5, physics: 6 });
  });

  it("exposes subject names so a subject nobody has ever posted can still get a column", async () => {
    const fake = new FakeFirestore();
    seed(fake);
    const r = await loadNotPostedIndex(args(fake));
    expect(r.subjects?.get("physics")).toEqual({ subjectName: "Physics", subjectCode: "" });
  });

  it("a legacy session with no period number covers its assignment's periods that day", async () => {
    const fake = new FakeFirestore();
    seed(fake);
    const r = await loadNotPostedIndex(args(fake, { submittedSessions: [{ assignmentId: "a2", date: "2026-10-06" }] }));
    expect(counts(r.index.forStudent({})).physics).toBe(5);
  });

  it("does not count today's period until it has ended, or any future date", async () => {
    const fake = new FakeFirestore();
    seed(fake);
    fake.seed(`${C}/timetableSlots/thu`, {
      sectionId: "s1", courseId: "co1", year: 1, semester: null, academicYear: "2026-27", createdAt: published,
      assignmentId: "a9", subjectId: "chem", subjectName: "Chem", day: "THU", periodNumber: 2, // 09:50-10:40, ended by 15:00
    });
    const r = await loadNotPostedIndex(args(fake, { to: "2026-12-31" }));
    expect(counts(r.index.forStudent({})).chem).toBe(6); // Thursdays Sep 3,10,17,24, Oct 1 + today Oct 8 (ended)
    const early = await loadNotPostedIndex(args(fake, { to: "2026-12-31", now: new Date(Date.UTC(2026, 9, 8, 3, 0, 0)) })); // 08:30 IST
    expect(counts(early.index.forStudent({})).chem).toBe(5); // today's period hasn't happened yet
  });

  it("never counts classes from before the timetable was published", async () => {
    const fake = new FakeFirestore();
    seed(fake);
    const r = await loadNotPostedIndex(args(fake, { from: "2026-04-01" }));
    expect(counts(r.index.forStudent({})).physics).toBe(6); // not 25+: nothing before the 1 Sep publication
  });

  it("is unavailable for a past academic year (the timetable describes the current cohort)", async () => {
    const fake = new FakeFirestore();
    seed(fake);
    const r = await loadNotPostedIndex(args(fake, { window: windowForAcademicYear("2025-26", cfg) }));
    expect(r.unavailable).toBe("PAST_YEAR");
    expect(r.index.total).toBe(0);
  });

  it("reports NO_TIMETABLE when the section has no live slots, and ignores another session's slots", async () => {
    const empty = new FakeFirestore();
    expect((await loadNotPostedIndex(args(empty))).unavailable).toBe("NO_TIMETABLE");
    const old = new FakeFirestore();
    seed(old, { academicYear: "2025-26" });
    expect((await loadNotPostedIndex(args(old))).unavailable).toBe("NO_TIMETABLE");
  });

  it("an unreadable period timing never makes up a class: today's periods are skipped, past days still count", async () => {
    const fake = new FakeFirestore();
    seed(fake);
    fake.docs.delete(`${C}/courseYearTimings/co1_year1`);
    const r = await loadNotPostedIndex(args(fake));
    expect(counts(r.index.forStudent({})).physics).toBe(6);
  });
});

describe("denominator mode", () => {
  it("parses the query flag", () => {
    expect(parseDenominatorParam("timetable")).toBe("TIMETABLE");
    expect(parseDenominatorParam("SUBMITTED")).toBe("SUBMITTED");
    expect(parseDenominatorParam("whatever")).toBeNull();
    expect(parseDenominatorParam(null)).toBeNull();
  });

  it("defaults to SUBMITTED (the original numbers) unless the request or the college says otherwise", async () => {
    const fake = new FakeFirestore();
    const db = asFirestore(fake);
    expect(await resolveDenominatorMode(db, "c1", null)).toBe("SUBMITTED");
    fake.seed(`${C}/settings/studentAttendance`, { heldDenominator: "TIMETABLE" });
    expect(await resolveDenominatorMode(db, "c1", null)).toBe("TIMETABLE");
    expect(await resolveDenominatorMode(db, "c1", "submitted")).toBe("SUBMITTED"); // the request wins
    fake.seed(`${C}/settings/studentAttendance`, { heldDenominator: "garbage" });
    expect(await resolveDenominatorMode(db, "c1", null)).toBe("SUBMITTED");
  });
});

describe("denominatorNumbers - both definitions side by side", () => {
  it("SUBMITTED mode leaves the original numbers as 'main' and offers the timetable ones as 'alt'", () => {
    const n = denominatorNumbers({ held: 8, attended: 6 }, 2, "SUBMITTED");
    expect(n.main).toEqual({ held: 8, attended: 6, percentage: 75 });
    expect(n.alt).toEqual({ mode: "TIMETABLE", held: 10, attended: 6, percentage: 60 });
  });
  it("TIMETABLE mode swaps them", () => {
    const n = denominatorNumbers({ held: 8, attended: 6 }, 2, "TIMETABLE");
    expect(n.main).toEqual({ held: 10, attended: 6, percentage: 60 });
    expect(n.alt).toMatchObject({ mode: "SUBMITTED", percentage: 75 });
  });
  it("nothing not-posted: the two agree", () => {
    const n = denominatorNumbers({ held: 8, attended: 6 }, 0, "TIMETABLE");
    expect(n.main.percentage).toBe(n.alt.percentage);
  });
});

describe("student roster sorting never crashes on a missing roll number (AT3)", () => {
  // The crash is position-dependent: it only throws when the student with no
  // roll number lands on the left of a comparison, i.e. anywhere but first.
  const roster = [
    { id: "s2", name: "Amy", rollNumber: "24PA1A0510" },
    { id: "s1", name: "Bob", rollNumber: "24PA1A0502" },
    { id: "s3", name: "Zed", rollNumber: undefined as unknown as string },
    { id: "s4", name: "Cat", rollNumber: "" },
  ];

  it("control: the bare comparator the routes used throws on a student with no roll number", () => {
    expect(() => [...roster].sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }))).toThrow(TypeError);
  });

  it("the shared comparator orders by roll then puts un-numbered students last, by name", () => {
    expect(sortStudentsForList([...roster]).map((s) => s.id)).toEqual(["s1", "s2", "s4", "s3"]);
  });
});
