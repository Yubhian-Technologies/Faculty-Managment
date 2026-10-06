import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  isAllowedReadOnlyPage, isAllowedReadOnlyRequest, isFacultyCapableRole, isReadOnlyFacultyStatus,
} from "@/lib/auth/readOnlyAccess";

describe("which statuses are read-only", () => {
  it("only RESIGNED and RETIRED", () => {
    expect(isReadOnlyFacultyStatus("RESIGNED")).toBe(true);
    expect(isReadOnlyFacultyStatus("RETIRED")).toBe(true);
    for (const s of ["ACTIVE", "ON_LEAVE", "RETAINERSHIP", "INTERVIEW_DONE", "", undefined, null, 5]) {
      expect(isReadOnlyFacultyStatus(s)).toBe(false);
    }
  });
});

describe("who is looked up", () => {
  it("there is no per-college switch any more: the module exports none", async () => {
    const mod = await import("@/lib/auth/readOnlyAccess") as Record<string, unknown>;
    expect(mod.isReadOnlyFacultyCollege).toBeUndefined();
    expect(mod.readOnlyFacultyColleges).toBeUndefined();
  });
  it("only faculty-capable roles are ever looked up", () => {
    for (const r of ["PANEL_MEMBER", "HOD", "DEPARTMENT_OFFICE"]) expect(isFacultyCapableRole(r)).toBe(true);
    for (const r of ["COLLEGE_OFFICE", "PRINCIPAL", "COLLEGE_STAFF", "STUDENT", "SUPER_ADMIN", undefined]) expect(isFacultyCapableRole(r)).toBe(false);
  });
});

describe("the allow-list of requests", () => {
  const ok = (m: string, p: string) => isAllowedReadOnlyRequest(m, p);

  it("allows only reads of own profile/history", () => {
    for (const p of [
      "/api/college/faculty/me", "/api/college/attendance", "/api/college/attendance/today-status", "/api/leave/applications",
      "/api/leave/balances", "/api/leave/profile", "/api/leave/attendance-calendar", "/api/leave/period-coverage",
      "/api/college/faculty/my-assignments", "/api/college/notifications", "/api/college/settings/general", "/api/college/info",
      "/api/leave/applications/abc123", "/api/college/faculty/me/",
    ]) expect(ok("GET", p), p).toBe(true);
    expect(ok("HEAD", "/api/college/faculty/me")).toBe(true);
  });

  it("denies EVERY write, even on an allowed path (notifications mark-as-read, profile edit, check-in, ...)", () => {
    for (const m of ["POST", "PATCH", "PUT", "DELETE", "post", "OPTIONS"]) {
      for (const p of ["/api/college/notifications", "/api/college/faculty/me", "/api/college/attendance", "/api/leave/applications", "/api/leave/applications/abc123"]) {
        expect(ok(m, p), `${m} ${p}`).toBe(false);
      }
    }
    expect(ok("POST", "/api/college/attendance/check-in")).toBe(false);
    expect(ok("PATCH", "/api/college/users/me/photo")).toBe(false);
  });

  it("denies every read that is not on the list (other people's data, lists, admin, seat pages)", () => {
    for (const p of [
      "/api/college/students", "/api/college/sections", "/api/college/faculty", "/api/college/users/abc", "/api/college/departments",
      "/api/college/timetable-slots", "/api/college/teaching-assignments", "/api/leave/profiles", "/api/leave/applications/abc/adjustment-response",
      "/api/college/role-seats", "/api/college/custom-nav", "/api/admin/users", "/api/college/attendance/face-registration",
      "/api/college/faculty/me/extra", "/api/college/faculty/mefoo", "/",
    ]) expect(ok("GET", p), p).toBe(false);
  });

  it("denies when the method or path is missing (no request context => fail closed)", () => {
    expect(ok("", "/api/college/faculty/me")).toBe(false);
    expect(isAllowedReadOnlyRequest(null, "/api/college/faculty/me")).toBe(false);
    expect(isAllowedReadOnlyRequest("GET", null)).toBe(false);
    expect(isAllowedReadOnlyRequest(undefined, undefined)).toBe(false);
  });

  it("every allowed path has a real route that exports GET (the list can't drift away from the code)", () => {
    const ALLOWED = [
      "college/faculty/me", "college/attendance", "college/attendance/today-status", "leave/applications", "leave/balances", "leave/profile",
      "leave/attendance-calendar", "leave/period-coverage", "college/faculty/my-assignments", "college/notifications", "college/settings/general", "college/info",
      "leave/applications/[id]",
    ];
    for (const r of ALLOWED) {
      const file = path.join(process.cwd(), "src/app/api", r, "route.ts");
      expect(fs.existsSync(file), file).toBe(true);
      expect(/export\s+async\s+function\s+GET\b/.test(fs.readFileSync(file, "utf8")), `${r} exports GET`).toBe(true);
    }
  });

  it("no allowed GET handler writes to Firestore directly", () => {
    const WRITE = /\.(set|update|add|delete|create)\(|runTransaction|writeAuditLog|notify\(/;
    for (const r of ["college/faculty/me", "college/attendance", "college/attendance/today-status", "leave/applications", "leave/balances", "leave/profile",
      "leave/attendance-calendar", "leave/period-coverage", "college/faculty/my-assignments", "college/notifications", "college/settings/general", "college/info", "leave/applications/[id]"]) {
      const src = fs.readFileSync(path.join(process.cwd(), "src/app/api", r, "route.ts"), "utf8");
      const m = /export\s+async\s+function\s+GET\b/.exec(src)!;
      const rest = src.slice(m.index);
      const next = rest.slice(1).search(/export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/);
      expect(WRITE.test(next < 0 ? rest : rest.slice(0, next + 1)), `${r} GET must not write`).toBe(false);
    }
  });
});

describe("which panel pages the UI lets a read-only person open", () => {
  it("profile (view), attendance and leave history", () => {
    for (const p of ["/panel/profile", "/panel/profile/personal", "/panel/attendance", "/panel/leave", "/panel/leave/history/casual"]) expect(isAllowedReadOnlyPage(p), p).toBe(true);
  });
  it("no edit/apply pages and nothing else", () => {
    for (const p of ["/panel/profile/edit", "/panel/profile/personal/edit", "/panel/leave/apply", "/panel", "/panel/students", "/panel/mark-attendance", "/hod/students", "/panel/profileX"]) expect(isAllowedReadOnlyPage(p), p).toBe(false);
  });
});
