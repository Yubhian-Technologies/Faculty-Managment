import { describe, expect, it } from "vitest";
import { onBehalfState } from "./onBehalf";
import { canAct } from "@/lib/certifications/decisionRules";

describe("College Admin acting on someone's behalf", () => {
  it("internal marks: a Mid not yet opened for faculty is open to the admin; Exam Cell mode and missing questions stay closed", () => {
    expect(onBehalfState({ midNumber: 1, mode: "FACULTY", facultyCanEdit: false, note: "Opens when ..." }, true).facultyCanEdit).toBe(true);
    expect(onBehalfState({ midNumber: 1, mode: "FACULTY", facultyCanEdit: false }, false).facultyCanEdit).toBe(false);
    expect(onBehalfState({ midNumber: 1, mode: "EXAM_CELL", facultyCanEdit: false }, true).facultyCanEdit).toBe(false);
  });

  it("certificates: the admin may decide any pending step (even one with no approver) but never its own request", () => {
    expect(canAct({ uid: "a", onBehalfAll: true }, "student", ["mentor"])).toBe(true);
    expect(canAct({ uid: "a", onBehalfAll: true }, "student", [])).toBe(true);
    expect(canAct({ uid: "a", onBehalfAll: true }, "a", ["mentor"])).toBe(false);
    expect(canAct({ uid: "x" }, "student", ["mentor"])).toBe(false);
    expect(canAct({ uid: "mentor" }, "student", ["mentor"])).toBe(true);
  });
});
