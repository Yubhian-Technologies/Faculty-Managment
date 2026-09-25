import { describe, expect, it } from "vitest";
import { computeEntitlement } from "./balanceEngine";
import { LEAVE_TYPE_SEED } from "./seedData";
import type { LeaveTypeCode, LeaveTypeFull } from "@/types/leave";

// Only computeEntitlement is covered here. splitLeaveDays, loadBalances and
// initBalancesForYear all read Firestore, and this repo has no Admin-SDK test
// harness - they are left to the manual checklist.

const type = (code: LeaveTypeCode): LeaveTypeFull => {
  const seed = LEAVE_TYPE_SEED.find((t) => t.code === code);
  if (!seed) throw new Error(`No seed for ${code}`);
  return seed as LeaveTypeFull;
};

describe("computeEntitlement", () => {
  // EL is the one type whose entitlement comes from the person's category
  // rather than rules.daysPerYear. Teaching staff get the long summer break
  // instead, so their earned leave is far smaller.
  it("gives EL 6 days to vacation staff and 30 to everyone else", () => {
    expect(computeEntitlement(type("EL"), "vacation")).toBe(6);
    expect(computeEntitlement(type("EL"), "non-vacation")).toBe(30);
    expect(computeEntitlement(type("EL"), "new-joining")).toBe(30);
  });

  it("reads every other type straight off rules.daysPerYear", () => {
    expect(computeEntitlement(type("CL"), "vacation")).toBe(12);
    expect(computeEntitlement(type("SL"), "non-vacation")).toBe(20);
    expect(computeEntitlement(type("SCL"), "vacation")).toBe(7);
  });

  it("does not vary a normal type by category", () => {
    for (const category of ["vacation", "non-vacation", "new-joining"] as const) {
      expect(computeEntitlement(type("CL"), category)).toBe(12);
    }
  });

  // OD and SH are rules.unlimited - no balance doc is ever created for them,
  // so entitlement is 0 rather than a number anyone draws down.
  it("gives an unlimited type no entitlement to track", () => {
    expect(computeEntitlement(type("OD"), "vacation")).toBe(0);
    expect(computeEntitlement(type("SH"), "vacation")).toBe(0);
  });

  it("falls back to zero for a type with no daysPerYear set", () => {
    const custom = { code: "CL", rules: { eligibleCategories: ["vacation"] } } as unknown as LeaveTypeFull;
    expect(computeEntitlement(custom, "vacation")).toBe(0);
  });
});
