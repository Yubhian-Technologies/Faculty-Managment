import { describe, expect, it } from "vitest";
import { isLeaveRequestEditable } from "./editability";

describe("isLeaveRequestEditable", () => {
  it("is editable while awaiting acceptance, before anyone has decided", () => {
    expect(isLeaveRequestEditable({ status: "PENDING_ACCEPTANCE" })).toBe(true);
  });

  it("is editable at its first pending stage, before that stage's approver acts", () => {
    expect(isLeaveRequestEditable({ status: "PENDING_HOD" })).toBe(true);
    expect(isLeaveRequestEditable({ status: "PENDING_PRINCIPAL" })).toBe(true);
  });

  it("locks once the HOD has acted, even if a later stage is still pending", () => {
    expect(
      isLeaveRequestEditable({
        status: "PENDING_VICE_PRINCIPAL",
        hodAction: { action: "APPROVED", by: "u1", byName: "HOD", at: null as never },
      })
    ).toBe(false);
  });

  it("locks once the Principal has acted", () => {
    expect(
      isLeaveRequestEditable({
        status: "APPROVED",
        principalAction: { action: "APPROVED", by: "u1", byName: "Principal", at: null as never },
      })
    ).toBe(false);
  });

  it("locks on every terminal status regardless of action records", () => {
    expect(isLeaveRequestEditable({ status: "APPROVED" })).toBe(false);
    expect(isLeaveRequestEditable({ status: "REJECTED" })).toBe(false);
    expect(isLeaveRequestEditable({ status: "CANCELLED" })).toBe(false);
  });
});
