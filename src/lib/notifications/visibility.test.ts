import { describe, expect, it } from "vitest";
import { hidePanelPrompts } from "./visibility";

const items = [
  { id: "1", type: "CANDIDATE_ARRIVED", title: "x" },
  { id: "2", type: "OTHER", title: "Panel Feedback Unlocked" },
  { id: "3", type: "OTHER", title: "Leave approved" },
];

describe("hidePanelPrompts", () => {
  it("hides panel prompts for leadership roles only", () => {
    for (const role of ["PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_ADMIN"]) expect(hidePanelPrompts(role, items).map((i) => i.id)).toEqual(["3"]);
    expect(hidePanelPrompts("HOD", items)).toHaveLength(3);
    expect(hidePanelPrompts(undefined, items)).toHaveLength(3);
  });
});
