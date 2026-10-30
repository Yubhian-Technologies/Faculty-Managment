import { describe, expect, it } from "vitest";
import { buildChain, checkLimits, clampLimits, enumerateDates, facultyPermissionInputSchema, hasEarlierPendingOverlap, isLate, isOwnProofUrl, mayRequest, noticeHours, resolveRequesters, permissionInputSchema, resolveProofRequired, shiftDate, spanDays } from "./rules";
import { ALL_CATEGORIES, categoryTypeKeys, findCategory, PERMISSION_GROUPS } from "./categories";
import { DEFAULT_LIMITS } from "./types";

const base = { categoryId: "external-participation.hackathons", title: "Smart India Hackathon", description: "Finals at IIT", fromDate: "2026-10-10", toDate: "2026-10-12", periods: "ALL" as const, proof: [{ url: "https://x.test/invite.pdf", name: "Invite" }] };

describe("categories", () => {
  it("has stable ids, group routing keys and no duplicates", () => {
    expect(PERMISSION_GROUPS).toHaveLength(9);
    expect(new Set(ALL_CATEGORIES.map((c) => c.id)).size).toBe(ALL_CATEGORIES.length);
    const c = findCategory("external-participation.hackathons")!;
    expect(c).toMatchObject({ label: "Hackathons", groupId: "external-participation" });
    expect(categoryTypeKeys(c)).toEqual(["external-participation.hackathons", "external-participation"]);
    expect(findCategory("nope")).toBeUndefined();
    expect(findCategory("research-projects.paper-publication-presentation")).toBeDefined();
    expect(findCategory("other.other")).toBeDefined();
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

describe("backdating limit", () => {
  const ok2 = { studentCount: 1, typeDisabled: false };
  const req = (fromDate: string, toDate = fromDate) => ({ ...base, fromDate, toDate });
  it("allows a start inside the window and refuses one before it", () => {
    expect(checkLimits(req("2026-10-19"), DEFAULT_LIMITS, { ...ok2, today: "2026-10-26" })).toEqual([]); // exactly 7 days back
    expect(checkLimits(req("2026-10-18"), DEFAULT_LIMITS, { ...ok2, today: "2026-10-26" })).toEqual(["A request can't start more than 7 days in the past"]);
  });
  it("a limit of 0 means no past dates at all, and 1 reads singular", () => {
    expect(checkLimits(req("2026-10-25"), { ...DEFAULT_LIMITS, maxBackdateDays: 0 }, { ...ok2, today: "2026-10-26" })).toEqual(["A request can't start in the past"]);
    expect(checkLimits(req("2026-10-24"), { ...DEFAULT_LIMITS, maxBackdateDays: 1 }, { ...ok2, today: "2026-10-26" })).toEqual(["A request can't start more than 1 day in the past"]);
  });
  it("today and the future are always fine, and without `today` nothing is checked", () => {
    expect(checkLimits(req("2026-10-26"), { ...DEFAULT_LIMITS, maxBackdateDays: 0 }, { ...ok2, today: "2026-10-26" })).toEqual([]);
    expect(checkLimits(req("2026-12-01"), DEFAULT_LIMITS, { ...ok2, today: "2026-10-26" })).toEqual([]);
    expect(checkLimits(req("2020-01-01"), DEFAULT_LIMITS, ok2)).toEqual([]);
  });
  it("works across a month and year boundary", () => {
    expect(shiftDate("2026-03-02", -7)).toBe("2026-02-23");
    expect(shiftDate("2027-01-03", -7)).toBe("2026-12-27");
    expect(shiftDate("2026-10-26", 0)).toBe("2026-10-26");
  });
  it("the configured value is clamped to 0-90 days", () => {
    expect(clampLimits({ maxBackdateDays: 500 })).toEqual({ maxBackdateDays: 90 });
    expect(clampLimits({ maxBackdateDays: -3 })).toEqual({ maxBackdateDays: 0 });
    expect(clampLimits({ maxBackdateDays: 3 })).toEqual({ maxBackdateDays: 3 });
  });
});

describe("hasEarlierPendingOverlap (double-submit guard)", () => {
  const own = { id: "b", createdAt: "2026-10-26T10:00:00.000Z", coverageDates: ["2026-10-27", "2026-10-28"], studentIds: ["s1"] };
  const other = (o: object) => ({ id: "a", status: "PENDING", createdAt: "2026-10-26T09:59:59.000Z", payload: { coverageDates: ["2026-10-28"], students: [{ id: "s1" }] }, ...o });
  it("an earlier pending request for the same student and a shared day means this one backs off", () => {
    expect(hasEarlierPendingOverlap(own, [other({})])).toBe(true);
  });
  it("a later request does not make the earlier one back off, so exactly one of two racers survives", () => {
    const later = other({ id: "c", createdAt: "2026-10-26T10:00:01.000Z" });
    expect(hasEarlierPendingOverlap(own, [later])).toBe(false);
    expect(hasEarlierPendingOverlap({ ...own, id: "c", createdAt: later.createdAt }, [{ ...other({}), id: "b", createdAt: own.createdAt }])).toBe(true);
  });
  it("the same instant is settled by id", () => {
    expect(hasEarlierPendingOverlap(own, [other({ id: "a", createdAt: own.createdAt })])).toBe(true);
    expect(hasEarlierPendingOverlap({ ...own, id: "a" }, [other({ id: "b", createdAt: own.createdAt })])).toBe(false);
  });
  it("ignores itself, finished requests, other students and other days", () => {
    expect(hasEarlierPendingOverlap(own, [other({ id: "b" })])).toBe(false);
    expect(hasEarlierPendingOverlap(own, [other({ status: "REJECTED" }), other({ status: "APPROVED" }), other({ status: "CANCELLED" })])).toBe(false);
    expect(hasEarlierPendingOverlap(own, [other({ payload: { coverageDates: ["2026-10-28"], students: [{ id: "s9" }] } })])).toBe(false);
    expect(hasEarlierPendingOverlap(own, [other({ payload: { coverageDates: ["2026-11-02"], students: [{ id: "s1" }] } })])).toBe(false);
  });
});

describe("checkLimits", () => {
  const ok = { studentCount: 1, typeDisabled: false };
  it("passes a compliant request", () => expect(checkLimits(base, DEFAULT_LIMITS, ok)).toEqual([]));
  it("requires otherCategory when categoryId is other.other", () => {
    expect(checkLimits({ ...base, categoryId: "other.other" }, DEFAULT_LIMITS, ok)).toEqual(["Specify the custom permission type"]);
    expect(checkLimits({ ...base, categoryId: "other.other", otherCategory: "Blood Donation" }, DEFAULT_LIMITS, ok)).toEqual([]);
  });
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
  it("falls back to the Principal when nothing is left, and sends a Principal requester to the Vice Principal", () => {
    expect(buildChain(["HOD"], { ...none, isHodOfDepartment: true })).toEqual(["PRINCIPAL"]);
    expect(buildChain(["PRINCIPAL"], { ...none, isPrincipal: true })).toEqual(["VICE_PRINCIPAL"]);
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

describe("proof requirement per permission type", () => {
  const hack = categoryTypeKeys(findCategory("external-participation.hackathons")!); // [item, group]
  it("defaults to required when nothing is configured", () => {
    expect(resolveProofRequired([undefined, undefined], hack)).toBe(true);
  });
  it("a type-level entry beats the general switch; the item beats its group", () => {
    const college = { proofRequired: true, proofByType: { "external-participation": false } };
    expect(resolveProofRequired([undefined, college], hack)).toBe(false);
    expect(resolveProofRequired([undefined, { proofByType: { "external-participation": false, "external-participation.hackathons": true } }], hack)).toBe(true);
    expect(resolveProofRequired([undefined, college], categoryTypeKeys(findCategory("certifications.nptel")!))).toBe(true);
  });
  it("the department's setting beats the college's", () => {
    expect(resolveProofRequired([{ proofRequired: false }, { proofByType: { "external-participation.hackathons": true } }], hack)).toBe(false);
    expect(resolveProofRequired([{ proofByType: { "external-participation": true } }, { proofRequired: false }], hack)).toBe(true);
  });
  it("clampLimits keeps only known types with boolean values", () => {
    expect(clampLimits({ proofByType: { "external-participation": false, bogus: true, "certifications.nptel": "x" as unknown as boolean } })).toEqual({ proofByType: { "external-participation": false } });
  });
  it("accepts only this college's own uploaded proof links", () => {
    const own = (c: string, p: string) => `https://firebasestorage.googleapis.com/v0/b/b/o/${encodeURIComponent(p)}?alt=media`.replace("COLLEGE", c);
    expect(isOwnProofUrl(own("c1", "student-permission-proofs/c1/u/a.pdf"), "c1")).toBe(true);
    expect(isOwnProofUrl(own("c2", "student-permission-proofs/c2/u/a.pdf"), "c1")).toBe(false);
    expect(isOwnProofUrl("https://x.test/student-permission-proofs/c1/a.pdf", "c1")).toBe(false);
    expect(isOwnProofUrl("not a url", "c1")).toBe(false);
  });
});

describe("who can request a permission type", () => {
  const keys = categoryTypeKeys(findCategory("external-participation.hackathons")!);
  it("is unrestricted until configured, then item beats group and department beats college", () => {
    expect(resolveRequesters([undefined, undefined], keys)).toBeNull();
    expect(resolveRequesters([undefined, { requestersByType: { "external-participation": ["STUDENT"] } }], keys)).toEqual(["STUDENT"]);
    expect(resolveRequesters([undefined, { requestersByType: { "external-participation": ["STUDENT"], "external-participation.hackathons": ["HOD"] } }], keys)).toEqual(["HOD"]);
    expect(resolveRequesters([{ requestersByType: { "external-participation": ["PANEL_MEMBER"] } }, { requestersByType: { "external-participation": ["STUDENT"] } }], keys)).toEqual(["PANEL_MEMBER"]);
  });
  it("checks the actor's roles, and clampLimits keeps only known roles and types", () => {
    expect(mayRequest(null, ["STUDENT"])).toBe(true);
    expect(mayRequest(["HOD"], ["PANEL_MEMBER", "HOD"])).toBe(true);
    expect(mayRequest(["HOD"], ["STUDENT"])).toBe(false);
    expect(clampLimits({ requestersByType: { "external-participation": ["STUDENT", "ADMIN"], bogus: ["HOD"], "certifications.nptel": [] } })).toEqual({ requestersByType: { "external-participation": ["STUDENT"] } });
  });
});

describe("stage hours and periods", () => {
  it("resolveStageHours: the department's setting beats the college's, per stage; unset = no limit", async () => {
    const { resolveStageHours } = await import("./rules");
    expect(resolveStageHours([{ stageHours: { HOD: 12 } }, { stageHours: { HOD: 48, VICE_PRINCIPAL: 24 } }], ["HOD", "VICE_PRINCIPAL", "PRINCIPAL"])).toEqual([12, 24, null]);
    expect(resolveStageHours([undefined, undefined], ["HOD"])).toEqual([null]);
  });

  it("clampLimits keeps only known stages with at least 1 hour, capped at 720", async () => {
    const { clampLimits } = await import("./rules");
    expect(clampLimits({ stageHours: { HOD: 24, PRINCIPAL: 0, BOGUS: 5, VICE_PRINCIPAL: 9999 } })?.stageHours).toEqual({ HOD: 24, VICE_PRINCIPAL: 720 });
    expect(clampLimits({ stageHours: { HOD: 0 } })?.stageHours).toBeUndefined();
  });

  it("periodsOverlap: ALL overlaps everything, lists only when they share a period", async () => {
    const { periodsOverlap, hasEarlierPendingOverlap } = await import("./rules");
    expect(periodsOverlap("ALL", [3])).toBe(true);
    expect(periodsOverlap([1, 2], [3, 4])).toBe(false);
    expect(periodsOverlap([1, 2], [2, 5])).toBe(true);
    const other = { id: "a", status: "PENDING", createdAt: "2026-10-01T00:00:00Z", payload: { coverageDates: ["2026-10-05"], students: [{ id: "s1" }], periods: [1] as number[] } };
    const own = { id: "b", createdAt: "2026-10-02T00:00:00Z", coverageDates: ["2026-10-05"], studentIds: ["s1"] };
    expect(hasEarlierPendingOverlap({ ...own, periods: [5] }, [other])).toBe(false); // different period, same day: both stand
    expect(hasEarlierPendingOverlap({ ...own, periods: [1] }, [other])).toBe(true);
  });
});
