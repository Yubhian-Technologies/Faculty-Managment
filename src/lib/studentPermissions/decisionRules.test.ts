import { describe, expect, it } from "vitest";
import { canDecideStage, type DecisionFacts } from "./decisionRules";

const f = (o: Partial<DecisionFacts>): DecisionFacts => ({
  stage: "HOD", actorUid: "a", requesterUid: "r", actorRoles: [], headsRequestDepartment: false, isRecordedIncharge: false, ...o,
});

describe("canDecideStage", () => {
  it("HOD stage needs the HOD role AND the department", () => {
    expect(canDecideStage(f({ actorRoles: ["HOD"], headsRequestDepartment: true }))).toBe(true);
    expect(canDecideStage(f({ actorRoles: ["HOD"], headsRequestDepartment: false }))).toBe(false); // another department's HOD
    expect(canDecideStage(f({ actorRoles: ["PANEL_MEMBER"], headsRequestDepartment: true }))).toBe(false);
  });
  it("class-incharge stage needs to be the recorded incharge, whatever other roles they hold", () => {
    expect(canDecideStage(f({ stage: "CLASS_INCHARGE", isRecordedIncharge: true }))).toBe(true);
    expect(canDecideStage(f({ stage: "CLASS_INCHARGE", actorRoles: ["HOD", "PRINCIPAL"], headsRequestDepartment: true }))).toBe(false);
  });
  it("Vice Principal / Principal stages are role-based and not interchangeable", () => {
    expect(canDecideStage(f({ stage: "VICE_PRINCIPAL", actorRoles: ["VICE_PRINCIPAL"] }))).toBe(true);
    expect(canDecideStage(f({ stage: "VICE_PRINCIPAL", actorRoles: ["PRINCIPAL"] }))).toBe(false);
    expect(canDecideStage(f({ stage: "PRINCIPAL", actorRoles: ["PRINCIPAL"] }))).toBe(true);
    expect(canDecideStage(f({ stage: "PRINCIPAL", actorRoles: ["HOD", "VICE_PRINCIPAL"] }))).toBe(false);
  });
  it("nobody decides their own request, even holding the right role", () => {
    expect(canDecideStage(f({ stage: "PRINCIPAL", actorRoles: ["PRINCIPAL"], actorUid: "r" }))).toBe(false);
    expect(canDecideStage(f({ stage: "HOD", actorRoles: ["HOD"], headsRequestDepartment: true, actorUid: "r" }))).toBe(false);
  });
  it("an unknown stage is never decidable", () => {
    expect(canDecideStage(f({ stage: "SOMETHING", actorRoles: ["PRINCIPAL", "HOD"], headsRequestDepartment: true }))).toBe(false);
  });
});
