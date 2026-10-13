import { describe, expect, it } from "vitest";
import { allBranchesAccepted, anyBranchRejected, canDecide } from "./decisionRules";
import type { CertificateClearance } from "@/types";

const branch = (status: CertificateClearance["status"]): CertificateClearance => ({
  branchKey: "LIBRARY", branchLabel: "Library", status,
});

describe("canDecide", () => {
  it("allows an actor who is in the resolved recipient set", () => {
    expect(canDecide("hod1", "student1", ["hod1", "hod2"])).toBe(true);
  });
  it("denies an actor not in the resolved recipient set", () => {
    expect(canDecide("stranger", "student1", ["hod1", "hod2"])).toBe(false);
  });
  it("denies the requester deciding their own request, even if somehow resolved", () => {
    expect(canDecide("student1", "student1", ["student1"])).toBe(false);
  });
});

describe("allBranchesAccepted", () => {
  it("is false when any branch is still pending", () => {
    expect(allBranchesAccepted([branch("ACCEPTED"), branch("PENDING")])).toBe(false);
  });
  it("is false when a branch was rejected", () => {
    expect(allBranchesAccepted([branch("ACCEPTED"), branch("REJECTED")])).toBe(false);
  });
  it("is true only when every branch accepted", () => {
    expect(allBranchesAccepted([branch("ACCEPTED"), branch("ACCEPTED")])).toBe(true);
  });
  it("is false for an empty branch list (degenerate, shouldn't happen)", () => {
    expect(allBranchesAccepted([])).toBe(false);
  });
});

describe("anyBranchRejected", () => {
  it("is true if any branch rejected", () => {
    expect(anyBranchRejected([branch("ACCEPTED"), branch("REJECTED")])).toBe(true);
  });
  it("is false if none rejected yet", () => {
    expect(anyBranchRejected([branch("ACCEPTED"), branch("PENDING")])).toBe(false);
  });
});
