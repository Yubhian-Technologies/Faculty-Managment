import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// POST student-attendance (faculty opens a period): empty-roster refusal, taking over a DRAFT
// another person opened, and the warn-only duplicate-period log. In-memory fakes; the
// timetable, calendar and roster lookups are stubbed.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeFirestore,
  roster: [] as { id: string; rollNumber: string; name: string }[],
}));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => ({ collegeId: "c1", uid: "u1", role: "PANEL_MEMBER" }),
}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));
vi.mock("@/lib/faculty/resolveFacultyMemberId", () => ({ resolveFacultyMemberId: async () => "f1" }));
vi.mock("@/lib/studentAttendance/classDay", () => ({ getNoClassReason: async () => null }));
vi.mock("@/lib/timetable/currentPeriod", () => ({
  checkFacultyPeriodWindow: async () => ({ ok: true, slot: { periodNumber: 2 }, startTime: "09:00", endTime: "10:00" }),
  periodWindowMessage: () => "window",
}));
vi.mock("@/lib/studentAttendance/labAllocation", () => ({ checkAllocatedAccess: async () => ({ ok: false }) }));
vi.mock("@/lib/students/labFacultyWindow", () => ({ loadLabWindows: async () => ({}), facultyActiveOn: () => true }));
vi.mock("@/lib/students/labBatchMode", () => ({ loadLabBatchModes: async () => ({}), effectiveLabBatch: () => undefined }));
vi.mock("@/lib/students/sectionRosterCache", () => ({ fetchSectionStudentsCached: async () => h.roster }));
vi.mock("@/lib/college/collegeAcademicYear", () => ({ resolveCollegeAcademicYear: async () => "2026-27" }));
vi.mock("@/lib/leave/periodCoverage", () => ({ resolveSubstituteSlotsForDate: async () => new Map() }));
vi.mock("@/lib/studentAttendance/onDuty", async () => ({
  ...(await vi.importActual<typeof import("@/lib/studentAttendance/onDuty")>("@/lib/studentAttendance/onDuty")),
  loadOnDutyDay: async () => null,
}));

import { POST } from "./route";

const C = "colleges/c1";
const ID = "a1_2026-10-07_2";
const students = [{ id: "s1", rollNumber: "1", name: "A" }, { id: "s2", rollNumber: "2", name: "B" }];
const seed = (extra: Record<string, Record<string, unknown>> = {}) => new FakeFirestore({
  [`${C}/teachingAssignments/a1`]: { facultyId: "f1", facultyName: "Dr Rao", sectionId: "sec1", subjectId: "sub1", subjectName: "Physics", subjectCode: "PH1", timetableSemester: 1 },
  [`${C}/sections/sec1`]: { department: "CSE", name: "A", year: 2, courseId: "btech" },
  ...extra,
});
const post = () =>
  POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assignmentId: "a1", date: "2026-10-07", periodNumber: 2 }) }));
const stored = () => h.db.get(`${C}/studentAttendance/${ID}`) as { facultyId: string; facultyName: string; entries: unknown[]; status: string } | undefined;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  h.roster = students;
  h.db = seed();
});

describe("POST student-attendance", () => {
  it("opens a DRAFT with the roster", async () => {
    const res = await post();
    expect(res.status).toBe(201);
    expect(stored()!.status).toBe("DRAFT");
    expect(stored()!.entries).toHaveLength(2);
  });

  it("refuses to open a class with no students and creates nothing", async () => {
    h.roster = [];
    const res = await post();
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/no students/i);
    expect(stored()).toBeUndefined();
  });

  it("hands a DRAFT another person opened to the authorised caller", async () => {
    h.db = seed({ [`${C}/studentAttendance/${ID}`]: {
      assignmentId: "a1", sectionId: "sec1", date: "2026-10-07", periodNumber: 2, status: "DRAFT", facultyId: "previous-faculty", facultyName: "Dr Old",
      substituteForFacultyId: "x", substituteForFacultyName: "X", totalStudents: 2, presentCount: 0,
      entries: students.map((s) => ({ studentId: s.id, rollNumber: s.rollNumber, name: s.name, status: null })),
    } });
    const res = await post();
    expect(res.status).toBe(200);
    expect(stored()!.facultyId).toBe("u1");
    expect(stored()!.facultyName).toBe("Dr Rao");
    expect(stored()).not.toHaveProperty("substituteForFacultyId");
    expect(((await res.json()) as { session: { facultyId: string } }).session.facultyId).toBe("u1");
  });

  it("returns an already submitted session untouched", async () => {
    h.db = seed({ [`${C}/studentAttendance/${ID}`]: { assignmentId: "a1", status: "SUBMITTED", facultyId: "previous-faculty", entries: [], totalStudents: 0 } });
    const res = await post();
    expect(res.status).toBe(200);
    expect(stored()!.facultyId).toBe("previous-faculty");
  });

  it("only warns, never refuses, when another assignment already has this class and period", async () => {
    h.db = seed({ [`${C}/studentAttendance/a2_2026-10-07_2`]: { assignmentId: "a2", sectionId: "sec1", date: "2026-10-07", periodNumber: 2, status: "SUBMITTED" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await post();
    expect(res.status).toBe(201);
    expect(warn).toHaveBeenCalledWith("[student-attendance duplicate-period]", expect.objectContaining({ id: ID, others: ["a2_2026-10-07_2"] }));
  });

  // Edge case: a leave substitute (not the assignment's own faculty) opens the
  // period. The assignment still belongs to the absent faculty ("f1"), but
  // resolveSubstituteSlotsForDate says the logged-in caller ("u1"/their
  // facultyMemberId "f1" per the module mock) is covering timetableSlot
  // "slotX" of this exact assignment today - so the route must own the
  // session to the SUBSTITUTE, not silently to whoever the assignment says.
  it("a leave substitute gets the attendance, stamped under their own identity", async () => {
    const periodCoverage = await import("@/lib/leave/periodCoverage");
    vi.spyOn(periodCoverage, "resolveSubstituteSlotsForDate").mockResolvedValue(
      new Map([["slotX", { originalFacultyId: "previous-faculty-uid", originalFacultyName: "Dr Old" }]])
    );
    h.db = seed({
      [`${C}/teachingAssignments/a1`]: { facultyId: "original-faculty-member-id", facultyName: "Dr Old", sectionId: "sec1", subjectId: "sub1", subjectName: "Physics", subjectCode: "PH1", timetableSemester: 1 },
      [`${C}/timetableSlots/slotX`]: { assignmentId: "a1" },
      [`${C}/facultyMembers/f1`]: { name: "Dr Substitute" },
    });
    const res = await post();
    expect(res.status).toBe(201);
    expect(stored()!.facultyId).toBe("u1"); // the substitute's own login uid, not "original-faculty-member-id"
    expect(stored()).toMatchObject({ substituteForFacultyId: "previous-faculty-uid", substituteForFacultyName: "Dr Old" });
  });
});
