import { describe, expect, it } from "vitest";
import { offSessionExams, roomClashes, roomUses } from "./seatingTiming";

const st = (g: string) => ({ id: g, rollNumber: g, name: g, sectionId: "s", sectionLabel: g, group: g });
const room = (roomId: string, groups: string[]) => ({ roomId, name: roomId, block: "A", floor: 1, capacity: 48, students: groups.map(st) });

describe("seating and exam timings", () => {
  it("a branch's second exam at another time keeps its room busy then - clashing with the other session's plan", () => {
    const morning = roomUses({ rooms: [room("201", ["CSE"])] }, (g) => (g === "CSE" ? [
      { date: "2026-10-01", from: "10:00", to: "11:30", subjects: ["DS"] },
      { date: "2026-10-02", from: "14:00", to: "15:30", subjects: ["DL"] },
    ] : []));
    const afternoon = roomUses({ rooms: [room("201", ["CIVIL"])] }, () => [
      { date: "2026-10-01", from: "14:00", to: "15:30", subjects: ["SUR"] },
      { date: "2026-10-02", from: "14:00", to: "15:30", subjects: ["FM"] },
    ]);
    const clashes = roomClashes(morning, [{ name: "Afternoon plan", uses: afternoon }]);
    expect(clashes.map((c) => [c.room, c.date, c.mine.group, c.theirs.group])).toEqual([["201", "2026-10-02", "CSE", "CIVIL"]]);
    expect(offSessionExams(morning, "10:00-11:30").map((u) => [u.group, u.date])).toEqual([["CSE", "2026-10-02"]]);
  });
});
