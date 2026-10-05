import { describe, expect, it } from "vitest";
import { buildChain, checkLimits, clampLimits, enumerateDates, facultyPermissionInputSchema, isLate, noticeHours, permissionInputSchema, spanDays } from "./rules";
import { ALL_CATEGORIES, categoryTypeKeys, findCategory, PERMISSION_GROUPS } from "./categories";
import { DEFAULT_LIMITS } from "./types";

const base = { categoryId: "external-participation.hackathons", title: "Smart India Hackathon", description: "Finals at IIT", fromDate: "2026-10-10", toDate: "2026-10-12", periods: "ALL" as const, proof: [{ url: "https://x.test/invite.pdf", name: "Invite" }] };

describe("categories", () => {
  it("has stable ids, group routing keys and no duplicates", () => {
    expect(PERMISSION_GROUPS).toHaveLength(8);
    expect(new Set(ALL_CATEGORIES.map((c) => c.id)).size).toBe(ALL_CATEGORIES.length);
    const c = findCategory("external-participation.hackathons")!;
    expect(c).toMatchObject({ label: "Hackathons", groupId: "external-participation" });
    expect(categoryTypeKeys(c)).toEqual(["external-participation.hackathons", "external-participation"]);
    expect(findCategory("nope")).toBeUndefined();
    expect(findCategory("research-projects.paper-publication-presentation")).toBeDefined();
  });
});

describe("input schema", () => {
  it("accepts a valid request and sorts/dedupes explicit periods", () => {
    expect(permissionInputSchema.safeParse(base).success).toBe(true);
    const r = permissionInputSchema.parse({ ...base, periods: [3, 1, 3] });
    expect(r.periods).toEqual([1, 3]);
  });
  it("rejects bad dates, reversed ranges, empty periods, and non-https proof", () => {
    const bad = (x: object) => permissionInputSchema.safeParse({ ...base, ...x }).success;
    expect(bad({ fromDate: "2026-02-30" })).toBe(false);
    expect(bad({ fromDate: "10-10-2026" })).toBe(false);
    expect(bad({ toDate: "2026-10-09" })).toBe(false);
    expect(bad({ periods: [] })).toBe(false);
    expect(bad({ periods: [0] })).toBe(false);
    expect(bad({ proof: [{ url: "http://x.test/a", name: "a" }] })).toBe(false);
    expect(bad({ proof: [{ url: "javascript:alert(1)", name: "a" }] })).toBe(false);
    expect(bad({ title: "  " })).toBe(false);
  });
  it("faculty requests need at least one student id", () => {
    expect(facultyPermissionInputSchema.safeParse({ ...base, studentIds: ["a"] }).success).toBe(true);
    expect(facultyPermissionInputSchema.safeParse({ ...base, studentIds: [] }).success).toBe(false);
  });
});

describe("dates", () => {
  it("enumerates inclusive ranges across month ends", () => {
    expect(enumerateDates("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(spanDays("2026-10-10", "2026-10-10")).toBe(1);
  });
});

describe("checkLimits", () => {
  const ok = { studentCount: 1, typeDisabled: false };
  it("passes a compliant request", () => expect(checkLimits(base, DEFAULT_LIMITS, ok)).toEqual([]));
  it("reports every problem it finds", () => {
    const errs = checkLimits({ ...base, categoryId: "zzz", toDate: "2026-12-30", proof: [] }, DEFAULT_LIMITS, { studentCount: 0, typeDisabled: false });
    expect(errs.join("|")).toMatch(/valid permission type/);
    expect(errs.join("|")).toMatch(/at most 15 days/);
    expect(errs.join("|")).toMatch(/proof/);
    expect(errs.join("|")).toMatch(/at least one student/);
  });
  it("honours a disabled type, optional proof and the student cap", () => {
    expect(checkLimits(base, DEFAULT_LIMITS, { studentCount: 1, typeDisabled: true }).join()).toMatch(/isn't enabled/);
    expect(checkLimits({ ...base, proof: [] }, { ...DEFAULT_LIMITS, proofRequired: false }, ok)).toEqual([]);
    expect(checkLimits(base, { ...DEFAULT_LIMITS, maxStudentsPerRequest: 2 }, { studentCount: 3, typeDisabled: false }).join()).toMatch(/at most 2 students/);
  });
});

describe("notice", () => {
  it("measures hours to the start of the first day in IST and flags short notice as late", () => {
    const now = new Date("2026-10-09T08:30:00+05:30"); // 15.5h before 10 Oct IST midnight
    expect(noticeHours(now, "2026-10-10")).toBe(15.5);
    expect(isLate(15.5, 24)).toBe(true);
    expect(isLate(noticeHours(new Date("2026-10-07T00:00:00+05:30"), "2026-10-10"), 24)).toBe(false);
  });
  it("is negative for a day already under way (back-dated), which is allowed but late", () => {
    const h = noticeHours(new Date("2026-10-12T10:00:00+05:30"), "2026-10-10");
    expect(h).toBeLessThan(0);
    expect(isLate(h, 24)).toBe(true);
  });
});

describe("buildChain", () => {
  const none = { isHodOfDepartment: false, isVicePrincipal: false, isPrincipal: false };
  it("keeps the configured route for an ordinary requester", () => {
    expect(buildChain(["CLASS_INCHARGE", "HOD"], none)).toEqual(["CLASS_INCHARGE", "HOD"]);
  });
  it("drops the stage the requester occupies so nobody approves their own request", () => {
    expect(buildChain(["HOD", "PRINCIPAL"], { ...none, isHodOfDepartment: true })).toEqual(["PRINCIPAL"]);
    expect(buildChain(["HOD", "VICE_PRINCIPAL", "PRINCIPAL"], { ...none, isVicePrincipal: true })).toEqual(["HOD", "PRINCIPAL"]);
  });
  it("falls back to the Principal when nothing is left, and refuses a Principal requester", () => {
    expect(buildChain(["HOD"], { ...none, isHodOfDepartment: true })).toEqual(["PRINCIPAL"]);
    expect(() => buildChain(["PRINCIPAL"], { ...none, isPrincipal: true })).toThrow(/Principal/);
  });
});

describe("clampLimits", () => {
  it("keeps values inside bounds and ignores absent fields", () => {
    expect(clampLimits({ maxDays: 999, advanceNoticeHours: -5, maxStudentsPerRequest: 0 })).toEqual({ maxDays: 60, advanceNoticeHours: 0, maxStudentsPerRequest: 1 });
    expect(clampLimits({ maxDays: 7.6 })).toEqual({ maxDays: 8 });
    expect(clampLimits({ proofRequired: false })).toEqual({ proofRequired: false });
    expect(clampLimits(undefined)).toBeUndefined();
    expect(clampLimits({ maxDays: Number.NaN })).toEqual({ maxDays: 15 });
  });
});
