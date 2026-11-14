import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";
import { parseOfflineMark } from "@/lib/studentAttendance/offlineMark";

// Attendance marked on the faculty's phone with no internet and sent later: after the college's closing time the
// period window refuses an ordinary submit, but one that says it was marked offline is accepted until the end of
// that day (the window's `untilEndOfDay`) and flagged `markedOffline` for the HOD.

const h = vi.hoisted(() => ({ db: null as unknown as FakeFirestore, windowCalls: [] as unknown[] }));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => ({ collegeId: "c1", uid: "u1", role: "PANEL_MEMBER" }),
}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));
vi.mock("@/lib/faculty/resolveFacultyMemberId", () => ({ resolveFacultyMemberId: async () => "f1" }));
// The college has closed for the day: only the end-of-day window (offline) is still open.
vi.mock("@/lib/timetable/currentPeriod", () => ({
  checkFacultyPeriodWindow: async (...args: unknown[]) => {
    const opts = (args[7] ?? {}) as { untilEndOfDay?: boolean };
    h.windowCalls.push(opts);
    return opts.untilEndOfDay
      ? { ok: true, slot: { periodNumber: 2 }, startTime: "09:00", endTime: "10:00" }
      : { ok: false, reason: "OUTSIDE_WINDOW", startTime: "09:00", endTime: "16:30", phase: "AFTER" };
  },
  periodWindowMessage: () => "This period's attendance window has closed.",
}));
vi.mock("@/lib/studentAttendance/labAllocation", () => ({ checkAllocatedAccess: async () => ({ ok: false }) }));

import { PATCH } from "./[id]/route";

const C = "colleges/c1";
const ID = "a1_2026-10-07_2";
const draft = {
  assignmentId: "a1", subjectId: "sub1", date: "2026-10-07", periodNumber: 2, facultyId: "u1", status: "DRAFT",
  totalStudents: 2, presentCount: 0, classNotes: "",
  entries: [
    { studentId: "s1", rollNumber: "1", name: "A", status: null },
    { studentId: "s2", rollNumber: "2", name: "B", status: null },
  ],
};
const full = [{ studentId: "s1", status: "PRESENT" }, { studentId: "s2", status: "ABSENT" }];
const patch = (body: Record<string, unknown>) =>
  PATCH(new Request("http://localhost/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: ID }) });
const saved = () => h.db.get(`${C}/studentAttendance/${ID}`) as { status: string; markedOffline?: { markedAt: string; syncedAt: string } };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.windowCalls = [];
  h.db = new FakeFirestore({ [`${C}/studentAttendance/${ID}`]: draft });
});

describe("offline-marked attendance", () => {
  it("an ordinary submit after closing time is refused", async () => {
    expect((await patch({ entries: full, classNotes: "Ch 3", submit: true })).status).toBe(403);
    expect(saved().status).toBe("DRAFT");
  });

  it("a submit marked offline is accepted the same day and flagged with the phone's time", async () => {
    const res = await patch({ entries: full, classNotes: "Ch 3", submit: true, offline: { markedAt: "2026-10-07T04:10:00.000Z" } });
    expect(res.status).toBe(200);
    expect(saved().status).toBe("SUBMITTED");
    expect(saved().markedOffline?.markedAt).toBe("2026-10-07T04:10:00.000Z");
    expect(h.windowCalls).toContainEqual({ untilEndOfDay: true });
  });

  it("the offline flag only stretches a submit, not a plain save", async () => {
    expect((await patch({ entries: full, offline: { markedAt: "2026-10-07T04:10:00.000Z" } })).status).toBe(403);
  });
});

describe("parseOfflineMark", () => {
  const now = new Date("2026-10-07T10:00:00.000Z");
  it("reads the phone's time; a time in the future is clamped to now; junk is ignored", () => {
    expect(parseOfflineMark({ markedAt: "2026-10-07T04:10:00.000Z" }, now)).toEqual({ markedAt: "2026-10-07T04:10:00.000Z" });
    expect(parseOfflineMark({ markedAt: "2026-10-08T04:10:00.000Z" }, now)).toEqual({ markedAt: now.toISOString() });
    expect(parseOfflineMark({ markedAt: "not a time" }, now)).toBeNull();
    expect(parseOfflineMark(undefined, now)).toBeNull();
    expect(parseOfflineMark("2026-10-07", now)).toBeNull();
  });
});
