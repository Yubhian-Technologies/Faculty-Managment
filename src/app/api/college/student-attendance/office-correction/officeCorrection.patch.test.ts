import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// Office correction (PATCH office-correction/[id]): the merge, the session write and the
// audit entry happen in one transaction, and the audit records what changed. In-memory fakes.

const h = vi.hoisted(() => ({ db: null as unknown as FakeFirestore }));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => ({ collegeId: "c1", uid: "hod1", role: "HOD" }),
}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));
vi.mock("@/lib/departments/scope", () => ({
  getHodDepartmentScope: async () => ({ ownDepartmentNames: ["CSE"] }),
  canHodManageFacultyDepartment: () => true,
}));
vi.mock("@/lib/attendance/officeCorrectionAccess", () => ({
  departmentOfficeBlocked: async () => false,
  facultyWindowClosed: () => true,
  FACULTY_WINDOW_OPEN_MESSAGE: "open",
  OFFICE_ATTENDANCE_DENIED_MESSAGE: "denied",
}));
vi.mock("@/lib/attendance/attendanceWindow", () => ({
  isManualEditWindowOpen: () => true,
  MANUAL_EDIT_WINDOW_CLOSED_MESSAGE: "closed",
}));
vi.mock("@/lib/timetable/currentPeriod", () => ({ getFacultyPeriodsForDate: async () => [] }));
vi.mock("@/lib/faculty/resolveFacultyMemberId", () => ({ resolveFacultyMemberId: async () => "f1" }));

import { PATCH } from "./[id]/route";

const C = "colleges/c1";
const ID = "a1_2026-10-07_2";
const session = (over: Record<string, unknown> = {}) => ({
  department: "CSE", assignmentId: "a1", date: "2026-10-07", periodNumber: 2, facultyId: "u9", facultyName: "Dr Rao",
  subjectName: "Physics", status: "SUBMITTED", totalStudents: 2, presentCount: 1, classNotes: "Ch 3",
  correctionReason: "Faculty forgot",
  entries: [
    { studentId: "s1", rollNumber: "1", name: "A", status: "PRESENT" },
    { studentId: "s2", rollNumber: "2", name: "B", status: "ABSENT" },
  ],
  ...over,
});
const patch = (body: Record<string, unknown>) =>
  PATCH(new Request("http://localhost/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: ID }) });
const audits = () => [...h.db.docs.entries()].filter(([p]) => p.startsWith(`${C}/auditLogs/`)).map(([, d]) => d as { details: { changes: unknown[]; previouslySubmitted: boolean } });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.db = new FakeFirestore({ [`${C}/studentAttendance/${ID}`]: session(), [`${C}/users/hod1`]: { name: "HOD" } });
});

describe("office-correction PATCH", () => {
  it("corrects a submitted record and audits exactly what changed", async () => {
    const res = await patch({ entries: [{ studentId: "s2", status: "PRESENT" }], reason: "Marked wrong" });
    expect(res.status).toBe(200);
    const saved = h.db.get(`${C}/studentAttendance/${ID}`) as { status: string; presentCount: number };
    expect(saved.status).toBe("SUBMITTED");
    expect(saved.presentCount).toBe(2);
    const log = audits();
    expect(log).toHaveLength(1);
    expect(log[0].details.changes).toEqual([{ studentId: "s2", from: "ABSENT", to: "PRESENT" }]);
    expect(log[0].details.previouslySubmitted).toBe(true);
  });

  it("writes neither the correction nor an audit entry when validation fails", async () => {
    h.db = new FakeFirestore({ [`${C}/studentAttendance/${ID}`]: session({ classNotes: "" }), [`${C}/users/hod1`]: { name: "HOD" } });
    const res = await patch({ entries: [{ studentId: "s2", status: "PRESENT" }] });
    expect(res.status).toBe(400);
    expect(audits()).toHaveLength(0);
    expect((h.db.get(`${C}/studentAttendance/${ID}`) as { presentCount: number }).presentCount).toBe(1);
  });

  it("rejects a malformed body with 400 instead of 500", async () => {
    expect((await patch({ entries: "nope" })).status).toBe(400);
    expect((await patch({ classNotes: 5 })).status).toBe(400);
  });

  it("keeps an ON_DUTY entry locked", async () => {
    h.db = new FakeFirestore({
      [`${C}/studentAttendance/${ID}`]: session({ entries: [
        { studentId: "s1", rollNumber: "1", name: "A", status: "ON_DUTY", previousStatus: "PRESENT" },
        { studentId: "s2", rollNumber: "2", name: "B", status: "ABSENT" },
      ] }),
      [`${C}/users/hod1`]: { name: "HOD" },
    });
    await patch({ entries: [{ studentId: "s1", status: "ABSENT" }], reason: "x" });
    const saved = h.db.get(`${C}/studentAttendance/${ID}`) as { entries: { studentId: string; status: string }[] };
    expect(saved.entries.find((e) => e.studentId === "s1")!.status).toBe("ON_DUTY");
  });
});
