import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// Late Marking through POST (open) and PATCH (submit): the usual window is closed; checkLatePeriod decides.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeFirestore,
  late: { ok: true } as Record<string, unknown>,
  notified: [] as unknown[],
}));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => ({ collegeId: "c1", uid: "u1", role: "PANEL_MEMBER" }),
}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));
vi.mock("@/lib/faculty/resolveFacultyMemberId", () => ({ resolveFacultyMemberId: async () => "f1" }));
vi.mock("@/lib/studentAttendance/classDay", () => ({ getNoClassReason: async () => null }));
vi.mock("@/lib/timetable/currentPeriod", () => ({
  checkFacultyPeriodWindow: async () => ({ ok: false, reason: "WRONG_DATE" }),
  periodWindowMessage: () => "Attendance can only be marked for the current date.",
}));
vi.mock("@/lib/studentAttendance/lateMarkServer", () => ({
  checkLatePeriod: async () => h.late,
  notifyLateMark: async (...a: unknown[]) => { h.notified.push(a[2]); },
}));
vi.mock("@/lib/studentAttendance/labAllocation", () => ({ checkAllocatedAccess: async () => ({ ok: false }) }));
vi.mock("@/lib/students/labFacultyWindow", () => ({ loadLabWindows: async () => ({}), facultyActiveOn: () => true }));
vi.mock("@/lib/students/labBatchMode", () => ({ loadLabBatchModes: async () => ({}), effectiveLabBatch: () => undefined }));
vi.mock("@/lib/studentAttendance/labClash", async () => ({
  ...(await vi.importActual<typeof import("@/lib/studentAttendance/labClash")>("@/lib/studentAttendance/labClash")),
  findLabClash: async () => [],
}));
vi.mock("@/lib/students/sectionRosterCache", () => ({ fetchSectionStudentsCached: async () => [{ id: "s1", rollNumber: "1", name: "A" }] }));
vi.mock("@/lib/studentAttendance/academicYearWindow", () => ({ resolveAcademicYearForDate: async () => "2026-27" }));
vi.mock("@/lib/leave/periodCoverage", () => ({ resolveSubstituteSlotsForDate: async () => new Map() }));
vi.mock("@/lib/studentAttendance/dayTally", () => ({ applyTallyDeltaInTx: () => {} }));
vi.mock("@/lib/studentAttendance/onDuty", async () => ({
  ...(await vi.importActual<typeof import("@/lib/studentAttendance/onDuty")>("@/lib/studentAttendance/onDuty")),
  loadOnDutyDay: async () => null,
}));

import { POST } from "./route";
import { PATCH } from "./[id]/route";

const C = "colleges/c1";
const ID = "a1_2026-11-24_2";
const req = (body: unknown, method = "POST") => new Request("http://localhost/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const open = (lateMark?: unknown) => POST(req({ assignmentId: "a1", date: "2026-11-24", periodNumber: 2, ...(lateMark ? { lateMark } : {}) }));
const stored = () => h.db.get(`${C}/studentAttendance/${ID}`) as Record<string, unknown> | undefined;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  h.notified = [];
  h.late = { ok: true, slot: { periodNumber: 2 }, startTime: "09:00", endTime: "09:50", notCheckedIn: true };
  h.db = new FakeFirestore({
    [`${C}/teachingAssignments/a1`]: { facultyId: "f1", facultyName: "Dr Rao", sectionId: "sec1", subjectId: "sub1", subjectName: "Physics", subjectCode: "PH1", timetableSemester: 1 },
    [`${C}/sections/sec1`]: { department: "CSE", name: "A", year: 2, courseId: "btech" },
  });
});

describe("Late Marking", () => {
  it("without a late mark, a closed window is refused as before", async () => {
    const res = await open();
    expect(res.status).toBe(403);
    expect(stored()).toBeUndefined();
  });

  it("a blank reason is refused; nothing is created", async () => {
    const res = await open({ reason: "  " });
    expect(res.status).toBe(400);
    expect(stored()).toBeUndefined();
  });

  it("refused by the late check (e.g. too old) - its message, nothing created", async () => {
    h.late = { ok: false, message: "Late marking is allowed only up to 3 days back. Ask your HOD to correct it." };
    const res = await open({ reason: "Network down" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/3 days/);
    expect(stored()).toBeUndefined();
  });

  it("opens with the reason stamped, submits, stamps submittedAt and tells the HOD", async () => {
    const res = await open({ reason: "Network down" });
    expect(res.status).toBe(201);
    expect(stored()!.lateMark).toMatchObject({ reason: "Network down", notCheckedIn: true });
    const sub = await PATCH(req({ entries: [{ studentId: "s1", status: "PRESENT" }], classNotes: "Unit 2", submit: true }, "PATCH"), { params: Promise.resolve({ id: ID }) });
    expect(sub.status).toBe(200);
    expect(stored()!.status).toBe("SUBMITTED");
    expect((stored()!.lateMark as { submittedAt?: string }).submittedAt).toBeTruthy();
    expect(h.notified).toHaveLength(1);
  });

  it("finishes a draft left during the window, keeping its marks", async () => {
    h.db.docs.set(`${C}/studentAttendance/${ID}`, {
      assignmentId: "a1", sectionId: "sec1", department: "CSE", date: "2026-11-24", periodNumber: 2, status: "DRAFT", facultyId: "u1", facultyName: "Dr Rao",
      totalStudents: 1, presentCount: 0, entries: [{ studentId: "s1", rollNumber: "1", name: "A", status: "ABSENT" }],
    });
    const res = await open({ reason: "Forgot to submit" });
    expect(res.status).toBe(200);
    expect(stored()!.lateMark).toMatchObject({ reason: "Forgot to submit" });
    expect((stored()!.entries as { status: string }[])[0].status).toBe("ABSENT");
  });

  it("a draft that was never late-marked can't be saved once its window closed", async () => {
    h.db.docs.set(`${C}/studentAttendance/${ID}`, {
      assignmentId: "a1", sectionId: "sec1", department: "CSE", date: "2026-11-24", periodNumber: 2, status: "DRAFT", facultyId: "u1",
      totalStudents: 1, presentCount: 0, entries: [{ studentId: "s1", rollNumber: "1", name: "A", status: null }],
    });
    const sub = await PATCH(req({ entries: [{ studentId: "s1", status: "PRESENT" }], classNotes: "x", submit: true }, "PATCH"), { params: Promise.resolve({ id: ID }) });
    expect(sub.status).toBe(403);
    expect(stored()!.status).toBe("DRAFT");
  });
});
