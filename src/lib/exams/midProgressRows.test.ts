import { describe, expect, it } from "vitest";
import { dropCoveredSections } from "./midProgressRows";

describe("Mid marks progress: a section taught by two faculty", () => {
  it("leaves out the second faculty's empty row once the section's sheet has marks", () => {
    const rows = [
      { sectionId: "ME", status: "SUBMITTED" as const, entered: 60, sheetId: "a1__m1", who: "Ramu" },
      { sectionId: "ME", status: "NOT_STARTED" as const, entered: 0, who: "Hemalatha" },
      { sectionId: "CE", status: "NOT_STARTED" as const, entered: 0, who: "Other" },
    ];
    expect(dropCoveredSections(rows).map((r) => r.who)).toEqual(["Ramu", "Other"]);
  });
  it("keeps both rows while nobody has started, and keeps two rows that both have marks", () => {
    const none = [{ sectionId: "ME", status: "NOT_STARTED" as const, entered: 0 }, { sectionId: "ME", status: "NOT_STARTED" as const, entered: 0 }];
    expect(dropCoveredSections(none)).toHaveLength(2);
    const both = [{ sectionId: "ME", status: "DRAFT" as const, entered: 3 }, { sectionId: "ME", status: "SUBMITTED" as const, entered: 60 }];
    expect(dropCoveredSections(both)).toHaveLength(2);
  });
});
