import { describe, expect, it } from "vitest";
import { normalizeReasonOptions, resolveLeaveType, sanitizeLeaveTypeRuleOverride } from "./resolveLeaveTypes";

describe("normalizeReasonOptions", () => {
  it("maps a legacy plain-string array to HOD-routed reasons (no migration needed)", () => {
    expect(normalizeReasonOptions(["Medical", "Personal"])).toEqual([
      { label: "Medical" },
      { label: "Personal" },
    ]);
  });

  it("passes the new object shape through unchanged", () => {
    expect(normalizeReasonOptions([{ label: "Exam duty", proofRoutedTo: "EXAM_CELL" }])).toEqual([
      { label: "Exam duty", proofRoutedTo: "EXAM_CELL" },
    ]);
  });

  it("drops an entry with no usable label and tolerates a mix of both shapes", () => {
    expect(normalizeReasonOptions(["Medical", { label: "Exam duty", proofRoutedTo: "EXAM_CELL" }, { label: "" }])).toEqual([
      { label: "Medical" },
      { label: "Exam duty", proofRoutedTo: "EXAM_CELL" },
    ]);
  });

  it("returns an empty array for anything that isn't an array", () => {
    expect(normalizeReasonOptions(undefined)).toEqual([]);
    expect(normalizeReasonOptions("not an array")).toEqual([]);
  });
});

describe("resolveLeaveType - old reasonOptions data resolves through", () => {
  it("resolves a college override still holding the legacy string[] shape", () => {
    const overrides = { CL: { reasonOptions: ["Medical", "Family"] as never } };
    const lt = resolveLeaveType(overrides, "CL");
    expect(lt?.rules.reasonOptions).toEqual([{ label: "Medical" }, { label: "Family" }]);
  });
});

describe("sanitizeLeaveTypeRuleOverride - reasonOptions", () => {
  it("accepts plain strings and upgrades them to { label }", () => {
    const result = sanitizeLeaveTypeRuleOverride({ reasonOptions: ["Medical"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rule.reasonOptions).toEqual([{ label: "Medical" }]);
  });

  it("accepts { label, proofRoutedTo: EXAM_CELL }", () => {
    const result = sanitizeLeaveTypeRuleOverride({ reasonOptions: [{ label: "Exam duty", proofRoutedTo: "EXAM_CELL" }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rule.reasonOptions).toEqual([{ label: "Exam duty", proofRoutedTo: "EXAM_CELL" }]);
  });

  it("rejects an invalid proofRoutedTo value", () => {
    const result = sanitizeLeaveTypeRuleOverride({ reasonOptions: [{ label: "Exam duty", proofRoutedTo: "REGISTRAR" }] });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty label", () => {
    const result = sanitizeLeaveTypeRuleOverride({ reasonOptions: [""] });
    expect(result.ok).toBe(false);
  });
});
