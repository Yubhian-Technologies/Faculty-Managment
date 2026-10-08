import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// PATCH student-attendance/[id] (faculty save / submit): body validation and the empty-roster
// refusal. In-memory fakes; the timetable window check is made to pass.

const h = vi.hoisted(() => ({ db: null as unknown as FakeFirestore }));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => ({ collegeId: "c1", uid: "u1", role: "PANEL_MEMBER" }),
}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));
vi.mock("@/lib/faculty/resolveFacultyMemberId", () => ({ resolveFacultyMemberId: async () => "f1" }));
vi.mock("@/lib/timetable/currentPeriod", () => ({
  checkFacultyPeriodWindow: async () => ({ ok: true, slot: { periodNumber: 2 }, startTime: "09:00", endTime: "10:00" }),
  periodWindowMessage: () => "window",
}));

import { PATCH } from "./[id]/route";

const C = "colleges/c1";
const ID = "a1_2026-10-07_2";
const draft = (over: Record<string, unknown> = {}) => ({
  assignmentId: "a1", subjectId: "sub1", date: "2026-10-07", periodNumber: 2, facultyId: "u1", status: "DRAFT",
  totalStudents: 2, presentCount: 0, classNotes: "",
  entries: [
    { studentId: "s1", rollNumber: "1", name: "A", status: null },
    { studentId: "s2", rollNumber: "2", name: "B", status: null },
  ],
  ...over,
});
const patch = (body: Record<string, unknown>) =>
  PATCH(new Request("http://localhost/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: ID }) });
const saved = () => h.db.get(`${C}/studentAttendance/${ID}`) as { status: string; presentCount: number; entries: { status: string | null }[] };
const full = [{ studentId: "s1", status: "PRESENT" }, { studentId: "s2", status: "ABSENT" }];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.db = new FakeFirestore({ [`${C}/studentAttendance/${ID}`]: draft() });
});

describe("PATCH student-attendance/[id]", () => {
  it("submits a fully marked session with class notes", async () => {
    const res = await patch({ entries: full, classNotes: "Chapter 3", submit: true });
    expect(res.status).toBe(200);
    expect(saved().status).toBe("SUBMITTED");
    expect(saved().presentCount).toBe(1);
  });

  it("refuses to submit while a student is unmarked", async () => {
    const res = await patch({ entries: [full[0]], classNotes: "Chapter 3", submit: true });
    expect(res.status).toBe(400);
    expect(saved().status).toBe("DRAFT");
  });

  it("refuses to submit a session with no students on its roster", async () => {
    h.db = new FakeFirestore({ [`${C}/studentAttendance/${ID}`]: draft({ totalStudents: 0, entries: [] }) });
    const res = await patch({ entries: [], classNotes: "Chapter 3", submit: true });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/no students/i);
    expect(saved().status).toBe("DRAFT");
  });

  it.each([
    ["entries is not a list", { entries: "nope" }],
    ["an entry has no studentId", { entries: [{ status: "PRESENT" }] }],
    ["classNotes is not text", { classNotes: 5 }],
    ["classNotes is far too long", { classNotes: "x".repeat(5001) }],
    ["a status is not PRESENT/ABSENT", { entries: [{ studentId: "s1", status: "ON_DUTY" }] }],
  ])("answers 400, not 500, when %s", async (_name, body) => {
    expect((await patch(body)).status).toBe(400);
  });

  it("refuses a second submit", async () => {
    await patch({ entries: full, classNotes: "Chapter 3", submit: true });
    expect((await patch({ entries: full, classNotes: "Chapter 3", submit: true })).status).toBe(409);
  });

  it("refuses another faculty member's session", async () => {
    h.db = new FakeFirestore({ [`${C}/studentAttendance/${ID}`]: draft({ facultyId: "someone-else" }) });
    expect((await patch({ entries: full, classNotes: "x", submit: true })).status).toBe(403);
  });
});
