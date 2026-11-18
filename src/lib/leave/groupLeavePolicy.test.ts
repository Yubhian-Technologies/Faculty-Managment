import { describe, expect, it } from "vitest";
import { lockedOverrideConflict, resolveLeaveType, withoutLockedFields } from "./resolveLeaveTypes";
import { sanitizeLocks } from "./groupLeavePolicy";
import type { GroupLeavePolicy } from "@/types/leave";

// The Super Admin's leave rules for every college: built-in -> group -> college, except locked rules.

const group = (g: Partial<GroupLeavePolicy>): GroupLeavePolicy => ({ rules: {}, locked: {}, ...g });

describe("group leave policy", () => {
  it("built-in default when nobody sets it (CL is full day only)", () => {
    expect(resolveLeaveType(undefined, "CL")?.rules.halfDayAllowed).toBeFalsy();
  });

  it("a group default applies, and a college may change it when not locked", () => {
    const g = group({ rules: { CL: { halfDayAllowed: true, maxConsecutiveDays: 3 } } });
    expect(resolveLeaveType(undefined, "CL", g)?.rules).toMatchObject({ halfDayAllowed: true, maxConsecutiveDays: 3 });
    expect(resolveLeaveType({ CL: { halfDayAllowed: false } }, "CL", g)?.rules).toMatchObject({ halfDayAllowed: false, maxConsecutiveDays: 3 });
  });

  it("a locked rule ignores the college's own value; other rules still follow the college", () => {
    const g = group({ rules: { CL: { halfDayAllowed: true } }, locked: { CL: ["halfDayAllowed"] } });
    const r = resolveLeaveType({ CL: { halfDayAllowed: false, maxConsecutiveDays: 2 } }, "CL", g)?.rules;
    expect(r).toMatchObject({ halfDayAllowed: true, maxConsecutiveDays: 2 });
  });

  it("locked without a group value keeps the built-in default for every college", () => {
    const g = group({ locked: { SL: ["halfDayAllowed"] } });
    expect(resolveLeaveType({ SL: { halfDayAllowed: false } }, "SL", g)?.rules.halfDayAllowed).toBe(true);
  });

  it("days per year by category from the group, locked", () => {
    const g = group({ rules: { CL: { entitlementByCategory: { "non-vacation": 10 } } }, locked: { CL: ["entitlementByCategory"] } });
    expect(resolveLeaveType({ CL: { entitlementByCategory: { "non-vacation": 15 } } }, "CL", g)?.rules.entitlementByCategory).toEqual({ "non-vacation": 10 });
  });

  it("a college save that changes a locked rule is refused; the same value is fine and dropped", () => {
    const g = group({ rules: { CL: { halfDayAllowed: true } }, locked: { CL: ["halfDayAllowed"], SL: ["reasons"] } });
    expect(lockedOverrideConflict({ CL: { halfDayAllowed: false } }, g)).toMatch(/Super Admin/);
    expect(lockedOverrideConflict({ CL: { halfDayAllowed: true } }, g)).toBeNull();
    expect(lockedOverrideConflict({ SL: { allowCustomReason: true } }, g)).toMatch(/Reason dropdown/);
    expect(withoutLockedFields({ CL: { halfDayAllowed: true, maxConsecutiveDays: 4 } }, g)).toEqual({ CL: { maxConsecutiveDays: 4 } });
  });

  it("lock lists accept only known leave types and rules", () => {
    const codes = new Set(["CL", "SL"]);
    expect(sanitizeLocks({ CL: ["halfDayAllowed", "halfDayAllowed"] }, codes)).toEqual({ ok: true, locked: { CL: ["halfDayAllowed"] } });
    expect(sanitizeLocks({ XX: [] }, codes)).toMatchObject({ ok: false });
    expect(sanitizeLocks({ CL: ["colour"] }, codes)).toMatchObject({ ok: false });
  });
});
