import { describe, expect, it } from "vitest";
import { bankStage, groupStage, nextApproval } from "./approval";

const owner = { isOwner: true, isHod: false };
const hod = { isOwner: false, isHod: true };
const other = { isOwner: false, isHod: false };

describe("question bank HOD approval", () => {
  it("stages", () => {
    expect(bankStage({ status: "IN_PROGRESS" })).toBe("IN_PROGRESS");
    expect(bankStage({ status: "COMPLETE" })).toBe("READY");
    expect(bankStage({ status: "COMPLETE", approval: "SUBMITTED" })).toBe("SUBMITTED");
    expect(bankStage({ status: "IN_PROGRESS", approval: "RETURNED" })).toBe("RETURNED");
    expect(bankStage({ status: "COMPLETE", approval: "APPROVED" })).toBe("APPROVED");
  });

  it("only the owner submits, and only a complete bank", () => {
    expect(nextApproval({ status: "IN_PROGRESS" }, "submit", owner)).toEqual({ error: "Complete every unit before submitting" });
    expect(nextApproval({ status: "COMPLETE" }, "submit", hod)).toHaveProperty("error");
    expect(nextApproval({ status: "COMPLETE" }, "submit", owner)).toEqual({ approval: "SUBMITTED" });
    expect(nextApproval({ status: "COMPLETE", approval: "SUBMITTED" }, "submit", owner)).toHaveProperty("error");
    expect(nextApproval({ status: "COMPLETE", approval: "RETURNED" }, "submit", owner)).toEqual({ approval: "SUBMITTED" });
  });

  it("only the branch HOD decides, only a submitted bank, a return needs remarks", () => {
    const sub = { status: "COMPLETE" as const, approval: "SUBMITTED" as const };
    expect(nextApproval(sub, "approve", other)).toHaveProperty("error");
    expect(nextApproval(sub, "approve", owner)).toHaveProperty("error");
    expect(nextApproval(sub, "approve", hod)).toEqual({ approval: "APPROVED" });
    expect(nextApproval(sub, "return", hod)).toHaveProperty("error");
    expect(nextApproval(sub, "return", hod, "Unit 2 Q4 repeats Q1")).toEqual({ approval: "RETURNED" });
    expect(nextApproval({ status: "COMPLETE" }, "approve", hod)).toEqual({ error: "It hasn't been submitted for approval" });
    expect(nextApproval({ status: "COMPLETE", approval: "APPROVED" }, "return", hod, "x")).toEqual({ error: "Already approved" });
  });

  it("withdraw only before the HOD decides", () => {
    expect(nextApproval({ status: "COMPLETE", approval: "SUBMITTED" }, "withdraw", owner)).toEqual({ approval: null });
    expect(nextApproval({ status: "COMPLETE", approval: "APPROVED" }, "withdraw", owner)).toHaveProperty("error");
  });

  it("a subject's stage from its sections' banks", () => {
    const secs = [{ bankId: "a" }, { bankId: "b" }];
    expect(groupStage(secs, [])).toBe("NOT_STARTED");
    expect(groupStage(secs, [{ id: "a", status: "COMPLETE", approval: "APPROVED" }, { id: "b", status: "COMPLETE", approval: "APPROVED" }])).toBe("APPROVED");
    expect(groupStage(secs, [{ id: "a", status: "COMPLETE", approval: "APPROVED" }, { id: "b", status: "COMPLETE", approval: "SUBMITTED" }])).toBe("SUBMITTED");
    expect(groupStage(secs, [{ id: "a", status: "COMPLETE", approval: "APPROVED" }, { id: "b", status: "COMPLETE", approval: "RETURNED" }])).toBe("RETURNED");
    expect(groupStage(secs, [{ id: "a", status: "COMPLETE" }, { id: "b", status: "COMPLETE", approval: "SUBMITTED" }])).toBe("READY");
    expect(groupStage([...secs, { bankId: null }], [{ id: "a", status: "COMPLETE", approval: "APPROVED" }, { id: "b", status: "COMPLETE", approval: "APPROVED" }])).toBe("IN_PROGRESS");
  });
});
