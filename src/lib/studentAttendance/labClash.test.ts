import { describe, expect, it } from "vitest";
import { clashingSlots, labClashMessage, sharedSessionMessage } from "./labClash";

const types: Record<string, "THEORY" | "PRACTICAL"> = { phyLab: "PRACTICAL", chemLab: "PRACTICAL", maths: "THEORY", elective: "THEORY" };
const typeOf = (id: string) => types[id];
const mine = { assignmentId: "a1", subjectId: "phyLab", semester: 1 };

describe("clashingSlots", () => {
  it("another lab in the same period clashes", () => {
    expect(clashingSlots(mine, [{ assignmentId: "a2", subjectId: "chemLab", subjectName: "Chemistry Lab", semester: 1 }], typeOf)).toHaveLength(1);
  });
  it("the same lab shared by a second faculty is one class (no batches needed)", () => {
    expect(clashingSlots(mine, [{ assignmentId: "a3", subjectId: "phyLab", subjectName: "Physics Lab" }], typeOf)).toEqual([]);
  });
  it("its own assignment's slot never clashes", () => {
    expect(clashingSlots(mine, [{ assignmentId: "a1", subjectId: "phyLab", subjectName: "Physics Lab" }], typeOf)).toEqual([]);
  });
  it("two theory classes (electives) do not clash", () => {
    expect(clashingSlots({ assignmentId: "a1", subjectId: "maths" }, [{ assignmentId: "a2", subjectId: "elective", subjectName: "Elective" }], typeOf)).toEqual([]);
  });
  it("another semester's slot does not clash", () => {
    expect(clashingSlots(mine, [{ assignmentId: "a2", subjectId: "chemLab", subjectName: "Chemistry Lab", semester: 2 }], typeOf)).toEqual([]);
  });
  it("a subject of unknown type counts only through the other side", () => {
    expect(clashingSlots({ assignmentId: "a1", subjectId: "x" }, [{ assignmentId: "a2", subjectId: "y", subjectName: "Y" }], typeOf)).toEqual([]);
  });
});

describe("labClashMessage", () => {
  it("names the subjects and the class in-charge", () => {
    const m = labClashMessage("CSM-A", [{ assignmentId: "a2", subjectId: "chemLab", subjectName: "Chemistry Lab" }], "K Lavanya");
    expect(m).toContain("Divide this section into lab batches before marking this lab.");
    expect(m).toContain("Chemistry Lab also runs in this period for CSM-A");
    expect(m).toContain("The class in-charge (K Lavanya) divides the students on Lab Batches");
  });
  it("says the HOD sets the class in-charge when there is none", () => {
    expect(labClashMessage("ME", [], undefined)).toContain("the HOD sets the class in-charge first");
  });
});

describe("sharedSessionMessage", () => {
  it("names who is marking it", () => {
    expect(sharedSessionMessage("Idea Lab", "CS", "Dr. S Kumar")).toContain("Idea Lab for CS in this period is already being marked by Dr. S Kumar.");
  });
});
