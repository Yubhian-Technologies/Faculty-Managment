import { describe, expect, it } from "vitest";
import { dmy, groupTopicsByDate } from "./topicsCovered";

describe("groupTopicsByDate", () => {
  it("joins a day's periods, orders newest first and shows repeated text once", () => {
    const rows = groupTopicsByDate([
      { date: "2026-03-11", periodNumber: 7, classNotes: "Fixed beams" },
      { date: "2026-03-11", periodNumber: 3, classNotes: "fixed beams " },
      { date: "2026-03-11", periodNumber: 4, classNotes: "Fixed beams" },
      { date: "2026-02-24", periodNumber: 5, classNotes: "Fixed beam with udl" },
    ]);
    expect(rows).toEqual([
      { date: "2026-03-11", periods: [3, 4, 7], topics: "fixed beams" },
      { date: "2026-02-24", periods: [5], topics: "Fixed beam with udl" },
    ]);
  });
  it("joins different topics of one day in period order", () => {
    const [row] = groupTopicsByDate([
      { date: "2026-01-24", periodNumber: 5, classNotes: "Problems" },
      { date: "2026-01-24", periodNumber: 2, classNotes: "Indeterminate structures" },
    ]);
    expect(row.topics).toBe("Indeterminate structures / Problems");
  });
  it("formats dates", () => expect(dmy("2026-03-11")).toBe("11/03/2026"));
});
