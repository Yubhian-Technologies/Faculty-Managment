import { describe, expect, it } from "vitest";
import { addStage, getRoute, isDisabled, moveStage, removeStage, setLimit, setRoute, setTypeDisabled } from "./ruleSetOps";

describe("setRoute / getRoute", () => {
  it("sets a route and reads it back", () => {
    const rs = setRoute(undefined, "STUDENT", "*", ["HOD"]);
    expect(rs).toEqual({ routes: { STUDENT: { "*": ["HOD"] } } });
    expect(getRoute(rs, "STUDENT", "*")).toEqual(["HOD"]);
    expect(getRoute(rs, "FACULTY", "*")).toEqual([]);
  });
  it("keeps other routes and clears an emptied one all the way up (no empty objects)", () => {
    let rs = setRoute(undefined, "STUDENT", "*", ["HOD"]);
    rs = setRoute(rs, "STUDENT", "certifications", ["CLASS_INCHARGE", "HOD"]);
    rs = setRoute(rs, "FACULTY", "*", ["PRINCIPAL"]);
    expect(setRoute(rs, "STUDENT", "certifications", []).routes!.STUDENT).toEqual({ "*": ["HOD"] });
    const cleared = setRoute(setRoute(setRoute(rs, "STUDENT", "*", []), "STUDENT", "certifications", []), "FACULTY", "*", []);
    expect(cleared).toEqual({});
  });
  it("never mutates its input", () => {
    const rs = setRoute(undefined, "STUDENT", "*", ["HOD"]);
    const snap = JSON.stringify(rs);
    setRoute(rs, "STUDENT", "*", ["PRINCIPAL"]); setRoute(rs, "STUDENT", "x", []);
    expect(JSON.stringify(rs)).toBe(snap);
  });
});

describe("setLimit / setTypeDisabled", () => {
  it("sets and removes limits, dropping the empty container", () => {
    const rs = setLimit(setLimit(undefined, "maxDays", 5), "proofRequired", false);
    expect(rs.limits).toEqual({ maxDays: 5, proofRequired: false });
    expect(setLimit(setLimit(rs, "maxDays", undefined), "proofRequired", undefined)).toEqual({});
  });
  it("switches types off and on without duplicates", () => {
    let rs = setTypeDisabled(undefined, "sports", true);
    rs = setTypeDisabled(rs, "sports", true);
    expect(rs.disabledTypes).toEqual(["sports"]);
    expect(isDisabled(rs, "sports")).toBe(true);
    expect(setTypeDisabled(rs, "sports", false)).toEqual({});
  });
});

describe("chain editing", () => {
  it("adds without duplicating, removes, and moves within bounds", () => {
    expect(addStage(["HOD"], "PRINCIPAL")).toEqual(["HOD", "PRINCIPAL"]);
    expect(addStage(["HOD"], "HOD")).toEqual(["HOD"]);
    expect(removeStage(["HOD", "PRINCIPAL"], "HOD")).toEqual(["PRINCIPAL"]);
    expect(moveStage(["A", "B", "C"], 0, 1)).toEqual(["B", "A", "C"]);
    expect(moveStage(["A", "B", "C"], 0, -1)).toEqual(["A", "B", "C"]);
    expect(moveStage(["A", "B", "C"], 2, 1)).toEqual(["A", "B", "C"]);
  });
});
