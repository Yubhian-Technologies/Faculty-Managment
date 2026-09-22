import { describe, expect, it } from "vitest";
import { resolveIsVacation, sanitizeLeaveVacationRoles } from "./staffCategoryRouting";

describe("resolveIsVacation", () => {
  it("keeps the built-in defaults when nothing is configured", () => {
    expect(resolveIsVacation(undefined, ["PANEL_MEMBER"], true)).toBe(true);
    expect(resolveIsVacation(undefined, ["PANEL_MEMBER"], false)).toBe(false);
    expect(resolveIsVacation(undefined, ["HOD", "PANEL_MEMBER"], true)).toBe(true);
    expect(resolveIsVacation(undefined, ["PRINCIPAL"], false)).toBe(true);
    expect(resolveIsVacation(undefined, ["T_AND_P"], false)).toBe(false);
    expect(resolveIsVacation(undefined, ["IQAC_COORDINATOR"], false)).toBe(false);
  });

  it("applies a per-role override", () => {
    expect(resolveIsVacation({ T_AND_P: true }, ["T_AND_P"], false)).toBe(true);
    expect(resolveIsVacation({ HOD: false }, ["HOD"], true)).toBe(false);
    expect(resolveIsVacation({ PANEL_MEMBER: false }, ["PANEL_MEMBER"], true)).toBe(false);
  });

  it("follows the highest seat, not the primary role", () => {
    expect(resolveIsVacation({ HOD: false }, ["HOD", "PANEL_MEMBER"], true)).toBe(false);
    expect(resolveIsVacation({ PANEL_MEMBER: false }, ["HOD", "PANEL_MEMBER"], true)).toBe(true);
  });

  it("ignores non-requester seats like the R&D Coordinator", () => {
    expect(resolveIsVacation({ HOD: false }, ["RND_COORDINATOR", "PANEL_MEMBER"], true)).toBe(true);
  });

  it("lets vacation win a same-level tie regardless of order", () => {
    const cfg = { HOD: false, ACADEMICS: true };
    expect(resolveIsVacation(cfg, ["HOD", "ACADEMICS"], true)).toBe(true);
    expect(resolveIsVacation(cfg, ["ACADEMICS", "HOD"], true)).toBe(true);
  });
});

describe("sanitizeLeaveVacationRoles", () => {
  it("rejects unknown roles and non-boolean values", () => {
    expect(sanitizeLeaveVacationRoles({ STUDENT: true }).ok).toBe(false);
    expect(sanitizeLeaveVacationRoles({ HOD: "yes" }).ok).toBe(false);
    expect(sanitizeLeaveVacationRoles({ HOD: true })).toEqual({ ok: true, value: { HOD: true } });
  });
});
