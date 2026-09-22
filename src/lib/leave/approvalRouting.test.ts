import { describe, expect, it } from "vitest";
import { resolveApproverStageForHeldRoles } from "./approvalRouting";

describe("resolveApproverStageForHeldRoles", () => {
  it("routes a faculty member who is also an HOD as an HOD (Principal tier)", () => {
    expect(resolveApproverStageForHeldRoles(undefined, ["HOD", "PANEL_MEMBER"], "HOD", true)).toBe("PRINCIPAL");
  });

  it("routes plain faculty to their HOD", () => {
    expect(resolveApproverStageForHeldRoles(undefined, ["PANEL_MEMBER"], "PANEL_MEMBER", true)).toBe("HOD");
  });

  it("ignores the R&D Coordinator seat - the holder's leave still goes to their HOD", () => {
    expect(resolveApproverStageForHeldRoles(undefined, ["RND_COORDINATOR", "PANEL_MEMBER"], "PANEL_MEMBER", true)).toBe("HOD");
  });

  it("uses the most senior seat: a Principal's leave goes to Management", () => {
    expect(resolveApproverStageForHeldRoles(undefined, ["PRINCIPAL", "HOD", "PANEL_MEMBER"], "PRINCIPAL", true)).toBe("MANAGEMENT");
  });

  it("breaks a same-level tie by the higher approver tier, whatever the order", () => {
    const routing = { HOD: "MANAGEMENT" as const };
    expect(resolveApproverStageForHeldRoles(routing, ["HOD", "ACADEMICS"], "HOD", true)).toBe("MANAGEMENT");
    expect(resolveApproverStageForHeldRoles(routing, ["ACADEMICS", "HOD"], "ACADEMICS", true)).toBe("MANAGEMENT");
  });
});
