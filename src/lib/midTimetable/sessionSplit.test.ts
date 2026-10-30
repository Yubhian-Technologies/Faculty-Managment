import { describe, expect, it } from "vitest";
import { splitBySession } from "@/lib/pdf/midTimetableTemplate";

const sl = (date: string, c: string, s: string) => ({ subjectId: c, subjectCode: c, subjectName: c, date, sessionId: s });
const sessions = [{ id: "S2", label: "Afternoon", from: "14:00", to: "15:30" }, { id: "S1", label: "Morning", from: "10:00", to: "11:30" }];

describe("session-wise timetables", () => {
  it("one sheet per session with the branches writing then, and only those exams", () => {
    const out = splitBySession({ courseName: "B.Tech", year: 2, semester: 3, midNumber: 1, days: ["2026-10-01", "2026-10-02"], sessions, rows: [
      { branch: "CSE", usualSessionId: "S1", slots: [sl("2026-10-01", "CS201", "S1"), sl("2026-10-02", "CS202", "S1"), sl("2026-10-02", "CS203", "S2")] },
      { branch: "CIVIL", usualSessionId: "S2", slots: [sl("2026-10-01", "CE201", "S2")] },
    ] });
    expect(out.map((x) => [x.sessionTitle, x.rows.map((r) => `${r.branch}:${r.slots.map((s) => s.subjectCode).join("+")}`), x.days])).toEqual([
      ["Morning", ["CSE:CS201+CS202"], ["2026-10-01", "2026-10-02"]],
      ["Afternoon", ["CSE:CS203", "CIVIL:CE201"], ["2026-10-01", "2026-10-02"]],
    ]);
  });
});
