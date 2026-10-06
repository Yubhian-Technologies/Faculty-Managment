import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";
import { departmentOfficeBlocked, facultyWindowClosed, officeMayEditAttendance } from "./officeCorrectionAccess";

const C = "C1";
const access = (department: string, data: Record<string, unknown>) => ({
  [`colleges/${C}/departmentOfficeAccess/${encodeURIComponent(department)}`]: data,
});
const dbWith = (docs: Record<string, Record<string, unknown>> = {}) => new FakeFirestore(docs) as unknown as Firestore;

describe("facultyWindowClosed", () => {
  const at = (iso: string) => new Date(iso); // instants; IST = UTC + 5:30
  it("a past day is always closed to the faculty", () => {
    expect(facultyWindowClosed("2026-11-09", "16:00", at("2026-11-10T04:00:00Z"))).toBe(true);
    expect(facultyWindowClosed("2026-11-09", undefined, at("2026-11-10T04:00:00Z"))).toBe(true);
  });
  it("today is closed only once the close time has passed", () => {
    expect(facultyWindowClosed("2026-11-10", "16:00", at("2026-11-10T09:30:00Z"))).toBe(false); // 15:00 IST
    expect(facultyWindowClosed("2026-11-10", "16:00", at("2026-11-10T10:30:00Z"))).toBe(true); // 16:00 IST
  });
  it("today with no known close time, and any future day, stay open", () => {
    expect(facultyWindowClosed("2026-11-10", undefined, at("2026-11-10T17:00:00Z"))).toBe(false);
    expect(facultyWindowClosed("2026-11-11", "16:00", at("2026-11-10T17:00:00Z"))).toBe(false);
  });
  it("uses the IST date, not UTC (23:00 UTC is already the next IST day)", () => {
    expect(facultyWindowClosed("2026-11-10", "16:00", at("2026-11-10T23:00:00Z"))).toBe(true);
  });
});

describe("Department Office permission", () => {
  it("is off unless the HOD switched it on", async () => {
    expect(await officeMayEditAttendance(dbWith(), C, "CSE")).toBe(false);
    expect(await officeMayEditAttendance(dbWith(access("CSE", { hrefs: ["/hod/faculty"] })), C, "CSE")).toBe(false);
    expect(await officeMayEditAttendance(dbWith(access("CSE", { editStudentAttendance: false })), C, "CSE")).toBe(false);
    expect(await officeMayEditAttendance(dbWith(access("CSE", { editStudentAttendance: true })), C, "CSE")).toBe(true);
  });

  it("is per department, including names that need encoding", async () => {
    const db = dbWith(access("Computer Science & Engineering", { editStudentAttendance: true }));
    expect(await officeMayEditAttendance(db, C, "Computer Science & Engineering")).toBe(true);
    expect(await officeMayEditAttendance(db, C, "Civil Engineering")).toBe(false);
  });

  it("never blocks an HOD, and blocks an office head only without the switch", async () => {
    const off = dbWith();
    const on = dbWith(access("CSE", { editStudentAttendance: true }));
    expect(await departmentOfficeBlocked(off, C, { realRole: "HOD" }, ["CSE"])).toBe(false);
    expect(await departmentOfficeBlocked(off, C, {}, ["CSE"])).toBe(false);
    expect(await departmentOfficeBlocked(off, C, { realRole: "DEPARTMENT_OFFICE" }, ["CSE"])).toBe(true);
    expect(await departmentOfficeBlocked(on, C, { realRole: "DEPARTMENT_OFFICE" }, ["CSE"])).toBe(false);
    expect(await departmentOfficeBlocked(on, C, { realRole: "DEPARTMENT_OFFICE" }, ["IT"])).toBe(true);
    expect(await departmentOfficeBlocked(on, C, { realRole: "DEPARTMENT_OFFICE" }, [])).toBe(true);
  });
});
