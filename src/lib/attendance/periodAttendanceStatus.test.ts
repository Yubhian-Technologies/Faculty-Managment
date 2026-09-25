import { describe, it, expect } from "vitest";
import { resolvePeriodCompletionStatus } from "./periodAttendanceStatus";

describe("periodAttendanceStatus", () => {
  it("marks a submitted session on-or-before the scheduled end as ON_TIME", () => {
    const submittedAt = new Date(Date.UTC(2026, 8, 25, 0, 10 * 60, 0)); // 10:00 IST
    const session = {
      status: "SUBMITTED" as const,
      submittedAt: { toDate: () => submittedAt } as any,
      entries: [] as any,
      totalStudents: 0,
      presentCount: 0,
    };
    expect(resolvePeriodCompletionStatus({ dateISO: "2026-09-25", endTime: "17:00", session })).toBe("ON_TIME");
  });

  it("marks a submitted session after the scheduled end as LATE", () => {
    const submittedAt = new Date(Date.UTC(2026, 8, 25, 0, 18 * 60, 0)); // 18:00 IST
    const session = {
      status: "SUBMITTED" as const,
      submittedAt: { toDate: () => submittedAt } as any,
      entries: [] as any,
      totalStudents: 0,
      presentCount: 0,
    };
    expect(resolvePeriodCompletionStatus({ dateISO: "2026-09-25", endTime: "17:00", session })).toBe("LATE");
  });

  it("marks a DRAFT with partial marks as IN_PROGRESS", () => {
    const session = {
      status: "DRAFT" as const,
      entries: [
        { studentId: "s1", rollNumber: "1", name: "A", status: "PRESENT" as const },
        { studentId: "s2", rollNumber: "2", name: "B", status: null },
      ] as any,
      totalStudents: 2,
      presentCount: 1,
    };
    expect(resolvePeriodCompletionStatus({ dateISO: "2026-09-25", endTime: "17:00", session })).toBe("IN_PROGRESS");
  });

  it("marks a DRAFT with no marks as NOT_MARKED on a past date", () => {
    const session = {
      status: "DRAFT" as const,
      entries: [] as any,
      totalStudents: 0,
      presentCount: 0,
    };
    expect(resolvePeriodCompletionStatus({ dateISO: "2025-01-02", endTime: "17:00", session })).toBe("NOT_MARKED");
  });

  it("marks a non-submitted session before the period ends as PENDING", () => {
    // Fixed `now` (10:00 IST, same date) rather than the real wall clock -
    // relying on `new Date()` here made this test start failing the moment
    // real time passed 17:00 IST on 2026-09-25, same as every other case in
    // this file already avoids by injecting its own timestamp.
    const now = new Date(Date.UTC(2026, 8, 25, 0, 10 * 60, 0));
    expect(resolvePeriodCompletionStatus({ dateISO: "2026-09-25", endTime: "17:00", session: null, now })).toBe("PENDING");
  });
});
