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
    // An HOD of the department is not the class incharge; the Principal / Vice Principal are overseers (see below).
    expect(canDecideStage(f({ stage: "CLASS_INCHARGE", actorRoles: ["HOD"], headsRequestDepartment: true }))).toBe(false);
  });
  it("Vice Principal / Principal stages need those roles - an HOD or faculty member can't take them", () => {
    expect(canDecideStage(f({ stage: "VICE_PRINCIPAL", actorRoles: ["VICE_PRINCIPAL"] }))).toBe(true);
    expect(canDecideStage(f({ stage: "PRINCIPAL", actorRoles: ["PRINCIPAL"] }))).toBe(true);
    expect(canDecideStage(f({ stage: "PRINCIPAL", actorRoles: ["HOD"], headsRequestDepartment: true }))).toBe(false);
    expect(canDecideStage(f({ stage: "VICE_PRINCIPAL", actorRoles: ["PANEL_MEMBER"] }))).toBe(false);
  });
  it("the Principal and Vice Principal may decide a request waiting at any stage", () => {
    for (const stage of ["CLASS_INCHARGE", "DELEGATED_FACULTY", "HOD", "VICE_PRINCIPAL", "PRINCIPAL"]) {
      expect(canDecideStage(f({ stage, actorRoles: ["PRINCIPAL"] }))).toBe(true);
      expect(canDecideStage(f({ stage, actorRoles: ["VICE_PRINCIPAL"] }))).toBe(true);
    }
  });
  it("nobody decides their own request, even holding the right role", () => {
    expect(canDecideStage(f({ stage: "PRINCIPAL", actorRoles: ["PRINCIPAL"], actorUid: "r" }))).toBe(false);
    expect(canDecideStage(f({ stage: "HOD", actorRoles: ["HOD"], headsRequestDepartment: true, actorUid: "r" }))).toBe(false);
  });
  it("DELEGATED_FACULTY stage allows designated faculty or department HOD", () => {
    expect(canDecideStage(f({ stage: "DELEGATED_FACULTY", isDelegatedFaculty: true }))).toBe(true);
    expect(canDecideStage(f({ stage: "DELEGATED_FACULTY", actorRoles: ["HOD"], headsRequestDepartment: true }))).toBe(true);
    expect(canDecideStage(f({ stage: "DELEGATED_FACULTY", isDelegatedFaculty: false, actorRoles: ["PANEL_MEMBER"] }))).toBe(false);
  });
  it("an unknown stage is never decidable", () => {
    expect(canDecideStage(f({ stage: "SOMETHING", actorRoles: ["PRINCIPAL", "HOD"], headsRequestDepartment: true }))).toBe(false);
  });
});
