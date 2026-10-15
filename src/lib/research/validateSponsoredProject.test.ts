import { describe, expect, it } from "vitest";
import { validateSponsoredProjectBody } from "./validateSponsoredProject";

// Only the Co-PI rules: the rest of the body is left empty, so the first thing the validator
// can complain about is something other than the Co-PIs (we compare messages, not null).
const base = { durationMonths: 12, tentativeOutcomes: "x", piDepartment: "CSE", piAffiliation: "SVEC" } as const;
const coPiMessage = (coPis: Parameters<typeof validateSponsoredProjectBody>[0]["coPis"]) =>
  validateSponsoredProjectBody({ ...base, coPiCount: coPis?.length ?? 0, coPis });

describe("Co-PI validation", () => {
  it("accepts a Co-PI from this college once a faculty member is picked", () => {
    expect(coPiMessage([{ name: "", department: "", affiliation: "", isInternal: true, facultyId: "EMP001" }])).not.toMatch(/Co-PI/);
  });
  it("asks for a pick when the college Co-PI has no faculty chosen", () => {
    expect(coPiMessage([{ name: "", department: "CSE", affiliation: "", isInternal: true, facultyId: " " }]))
      .toBe("Pick the faculty member for every Co-PI from this college");
  });
  it("needs name, department and affiliation for an Other Co-PI", () => {
    expect(coPiMessage([{ name: "Dr X", department: "Physics", affiliation: "", isInternal: false }]))
      .toBe("Every Co-PI from another institution needs a Name, Department and Affiliation");
    expect(coPiMessage([{ name: "Dr X", department: "Physics", affiliation: "IIT" }])).not.toMatch(/Co-PI/);
  });
  it("treats a Co-PI saved before the option existed (no flag) as Other", () => {
    expect(coPiMessage([{ name: "Dr Old", department: "Maths", affiliation: "JNTU" }])).not.toMatch(/Co-PI/);
  });
  it("needs the rows when a count is given", () => {
    expect(coPiMessage([])).not.toBeNull();
    expect(validateSponsoredProjectBody({ ...base, coPiCount: 2, coPis: [] })).toBe("Add the details of every Co-PI");
  });
});
