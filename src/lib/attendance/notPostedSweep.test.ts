import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/leave/periodCoverage", () => ({ resolveSubstituteSlotsForDate: vi.fn(async () => new Map()) }));

import { runNotPostedSweep, sweepCollege } from "./notPostedSweep";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";
import { Timestamp } from "firebase-admin/firestore";

const C = "colleges/c1";
// Monday 2026-10-05, at 18:00 IST (12:30 UTC) and at 19:00 IST.
const AT_1800 = new Date(Date.UTC(2026, 9, 5, 12, 30, 0));
const AT_1900 = new Date(Date.UTC(2026, 9, 5, 13, 30, 0));

function college(fake: FakeFirestore, id = "c1", over: { lateClass?: boolean } = {}) {
  const c = `colleges/${id}`;
  fake.seed(c, { name: id });
  fake.seed(`${c}/settings/attendanceNotPostedSettings`, { enabled: true, cutoffTime: "17:00" });
  fake.seed(`${c}/courseYearTimings/co1_year1`, {
    courseId: "co1", year: 1, collegeStartTime: "09:00", numberOfPeriods: 3, periodDurationMinutes: 50,
    lunchBreak: { afterPeriod: 0, durationMinutes: 0 }, shortBreaks: [],
    periods: [
      { period: 1, startTime: "09:00", endTime: "09:50" },
      { period: 2, startTime: "09:50", endTime: "10:40" },
      { period: 3, startTime: "18:00", endTime: "18:50" },
    ],
  });
  const slot = (sid: string, facultyId: string, assignmentId: string, periodNumber: number) =>
    fake.seed(`${c}/timetableSlots/${sid}`, {
      facultyId, assignmentId, periodNumber, day: "MON", courseId: "co1", year: 1, sectionId: "s1", subjectId: "sub" + assignmentId,
      subjectName: "Subject " + assignmentId, semester: null,
    });
  slot("x1", "f1", "a1", 1);
  slot("x2", "f1", "a2", 2);
  slot("x3", "f2", "a3", 1);
  if (over.lateClass) slot("x4", "f2", "a4", 3);
  fake.seed(`${c}/facultyMembers/f1`, { userUid: "u1", legalName: "F One" });
  fake.seed(`${c}/facultyMembers/f2`, { userUid: "u2", legalName: "F Two" });
}
const notifications = (fake: FakeFirestore, id = "c1") => fake.list(`colleges/${id}/notifications`);
const markers = (fake: FakeFirestore, id = "c1") => fake.list(`colleges/${id}/attendanceNotPostedSent`);
const submit = (fake: FakeFirestore, assignmentId: string, periodNumber: number) =>
  fake.seed(`${C}/studentAttendance/${assignmentId}_2026-10-05_${periodNumber}`, { status: "SUBMITTED", submittedAt: Timestamp.fromDate(new Date(Date.UTC(2026, 9, 5, 4, 0, 0))) });

describe("sweepCollege - per-period dedupe", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tells each faculty member once about the periods they missed, and marks the day swept", async () => {
    const fake = new FakeFirestore({ latencyMs: 2 });
    college(fake);
    submit(fake, "a2", 2); // f1 posted period 2, missed period 1
    const r = await sweepCollege(asFirestore(fake), "c1", AT_1800);
    expect(r).toMatchObject({ swept: true, notified: 2, periodsNotified: 2 });
    expect(notifications(fake)).toHaveLength(2);
    expect(notifications(fake).map((n) => n.toUid).sort()).toEqual(["u1", "u2"]);
    expect(markers(fake).map((m) => m.id).sort()).toEqual(["f1_2026-10-05_a1_1", "f2_2026-10-05_a3_1"]);
    expect(fake.read(`${C}/settings/attendanceNotPostedSettings`)!.lastRunDate).toBe("2026-10-05");
  });

  it("does not run before the cutoff, when disabled, or again once the day is swept", async () => {
    const fake = new FakeFirestore();
    college(fake);
    expect(await sweepCollege(asFirestore(fake), "c1", new Date(Date.UTC(2026, 9, 5, 10, 0, 0)))).toMatchObject({ swept: false, notified: 0 }); // 15:30 IST
    await sweepCollege(asFirestore(fake), "c1", AT_1800);
    const count = notifications(fake).length;
    expect(await sweepCollege(asFirestore(fake), "c1", AT_1900)).toMatchObject({ swept: false, notified: 0 });
    expect(notifications(fake)).toHaveLength(count);

    const off = new FakeFirestore();
    college(off);
    off.seed(`${C}/settings/attendanceNotPostedSettings`, { enabled: false, cutoffTime: "17:00" });
    expect((await sweepCollege(asFirestore(off), "c1", AT_1800)).swept).toBe(false);
    expect(notifications(off)).toHaveLength(0);
  });

  it("a period that ends after an earlier tick is reported on the NEXT tick, and the first ones are not repeated", async () => {
    const fake = new FakeFirestore();
    college(fake, "c1", { lateClass: true }); // f2 also teaches period 3, 18:00-18:50
    const first = await sweepCollege(asFirestore(fake), "c1", AT_1800);
    expect(first.swept).toBe(false); // period 3 is still in session - more to come
    expect(first.periodsNotified).toBe(3); // f1: P1+P2, f2: P1 (P3 hasn't ended)
    expect(fake.read(`${C}/settings/attendanceNotPostedSettings`)!.lastRunDate).toBeUndefined();

    const second = await sweepCollege(asFirestore(fake), "c1", AT_1900);
    expect(second).toMatchObject({ swept: true, notified: 1, periodsNotified: 1 }); // only f2's period 3
    expect(notifications(fake)).toHaveLength(3);
    const latest = notifications(fake).filter((n) => n.toUid === "u2");
    expect(latest).toHaveLength(2);
    expect(latest.map((n) => n.title).sort()).toEqual(["Attendance not posted", "Attendance not posted"]);
  });

  it("rerunning the same tick (a retry) never double-notifies", async () => {
    const fake = new FakeFirestore();
    college(fake);
    await sweepCollege(asFirestore(fake), "c1", AT_1800);
    fake.seed(`${C}/settings/attendanceNotPostedSettings`, { enabled: true, cutoffTime: "17:00" }); // un-mark the day
    const again = await sweepCollege(asFirestore(fake), "c1", AT_1800);
    expect(again.periodsNotified).toBe(0);
    expect(notifications(fake)).toHaveLength(2);
  });

  it("a crash between sending and claiming the periods repeats an idempotent notification, never a second one", async () => {
    const fake = new FakeFirestore();
    college(fake);
    fake.failWhen = (ops) => ops.some((o) => o.path.includes("/attendanceNotPostedSent/")); // markers fail to commit
    await expect(sweepCollege(asFirestore(fake), "c1", AT_1800)).rejects.toThrow(/faculty failed/);
    const sent = notifications(fake).length;
    expect(sent).toBeGreaterThan(0);
    expect(fake.read(`${C}/settings/attendanceNotPostedSettings`)!.lastRunDate).toBeUndefined(); // not marked swept
    fake.failWhen = null;
    await sweepCollege(asFirestore(fake), "c1", AT_1800); // the retry
    expect(notifications(fake)).toHaveLength(sent); // same dedupe keys -> no duplicates
    expect(markers(fake).length).toBeGreaterThan(0);
  });

  it("one faculty member failing does not stop the others, and the day is not marked swept", async () => {
    const fake = new FakeFirestore();
    college(fake);
    fake.failWhen = (ops) => ops.some((o) => o.path.includes("f1_2026-10-05")); // only f1's marker commit fails
    await expect(sweepCollege(asFirestore(fake), "c1", AT_1800)).rejects.toThrow(/1 of 2 faculty failed/);
    expect(notifications(fake).map((n) => n.toUid)).toContain("u2"); // f2 was still told
  });

  it("nothing to report when everyone posted", async () => {
    const fake = new FakeFirestore();
    college(fake);
    submit(fake, "a1", 1); submit(fake, "a2", 2); submit(fake, "a3", 1);
    const r = await sweepCollege(asFirestore(fake), "c1", AT_1800);
    expect(r).toMatchObject({ swept: true, notified: 0 });
    expect(notifications(fake)).toHaveLength(0);
  });

  it("a holiday sweeps nothing and is marked done", async () => {
    const fake = new FakeFirestore();
    college(fake);
    fake.seed(`${C}/holidays/h`, { date: Timestamp.fromDate(new Date("2026-10-05T00:00:00+05:30")), name: "Festival" });
    const r = await sweepCollege(asFirestore(fake), "c1", AT_1800);
    expect(r).toMatchObject({ swept: true, notified: 0 });
    expect(notifications(fake)).toHaveLength(0);
  });
});

describe("runNotPostedSweep - failures are isolated and recorded", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a failing college does not stop the others; it is reported and counted in the heartbeat", async () => {
    const fake = new FakeFirestore();
    college(fake, "c1");
    college(fake, "c2");
    fake.failWhen = (ops) => ops.some((o) => o.path.startsWith("colleges/c2/attendanceNotPostedSent/"));
    const r = await runNotPostedSweep(asFirestore(fake), AT_1800);
    expect(r.collegesChecked).toBe(2);
    expect(r.failed.map((f) => f.collegeId)).toEqual(["c2"]);
    expect(r.collegesSwept).toBe(1);
    expect(notifications(fake, "c1")).toHaveLength(2);
    const hb = fake.read("systemJobs/attendance-not-posted")!;
    expect(hb).toMatchObject({ failedColleges: ["c2"], consecutiveFailures: 1, collegesChecked: 2 });
    expect(hb.lastFailureAt).toBeDefined();

    const again = await runNotPostedSweep(asFirestore(fake), AT_1800);
    expect(fake.read("systemJobs/attendance-not-posted")!.consecutiveFailures).toBe(2);
    expect(again.failed).toHaveLength(1);
  });

  it("a clean run records success and resets the failure streak", async () => {
    const fake = new FakeFirestore();
    college(fake, "c1");
    fake.seed("systemJobs/attendance-not-posted", { consecutiveFailures: 4, lastError: "boom", failedColleges: ["c9"] });
    const r = await runNotPostedSweep(asFirestore(fake), AT_1800);
    expect(r.failed).toEqual([]);
    expect(fake.read("systemJobs/attendance-not-posted")).toMatchObject({ consecutiveFailures: 0, lastError: "", failedColleges: [] });
    expect(fake.read("systemJobs/attendance-not-posted")!.lastOkAt).toBeDefined();
  });

  it("losing the heartbeat write does not fail the sweep", async () => {
    const fake = new FakeFirestore();
    college(fake, "c1");
    fake.failWhen = (ops) => ops.some((o) => o.path.startsWith("systemJobs/"));
    const r = await runNotPostedSweep(asFirestore(fake), AT_1800);
    expect(r.failed).toEqual([]);
    expect(r.facultyNotified).toBe(2);
  });
});
