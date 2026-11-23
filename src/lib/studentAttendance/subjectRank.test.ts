import { describe, expect, it } from "vitest";
import { subjectRank } from "./history";

describe("subjectRank", () => {
  it("theory, then labs, then tutorials / projects, then co-curricular", () => {
    const rows: [Parameters<typeof subjectRank>[0], string][] = [
      [{ type: "THEORY", nonTeachingLoad: true }, "Library"],
      [{ type: "PRACTICAL" }, "Programming for Problem Solving Lab"],
      [{ type: "NON_TEACHING" }, "Counseling"],
      [{ type: "THEORY" }, "Digital Logic Design"],
      [{ type: "PROJECT" }, "Mini Project"],
      [undefined, "Physics Lab"],
      [undefined, "Old Theory Subject"],
    ];
    const ordered = [...rows].sort((a, b) => subjectRank(a[0], a[1]) - subjectRank(b[0], b[1]) || a[1].localeCompare(b[1])).map((r) => r[1]);
    expect(ordered).toEqual(["Digital Logic Design", "Old Theory Subject", "Physics Lab", "Programming for Problem Solving Lab", "Mini Project", "Counseling", "Library"]);
  });
});
