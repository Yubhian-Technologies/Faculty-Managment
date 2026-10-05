import { describe, expect, it } from "vitest";
import { indexSessions, tallyStudentBySubject } from "./counting";
import { sessionContribution, sessionTallyDelta, tallySectionKey, type TallySession } from "./dayTally";

const session = (over: Partial<TallySession>, marks: Record<string, string | null>): TallySession => ({
  status: "SUBMITTED",
  date: "2026-10-05",
  sectionId: "sec1",
  subjectId: "maths",
  entries: Object.entries(marks).map(([studentId, status]) => ({ studentId, status })),
  ...over,
});

describe("sessionContribution", () => {
  it("counts only SUBMITTED sessions", () => {
    expect(sessionContribution(session({ status: "DRAFT" }, { s1: "PRESENT" })).size).toBe(0);
    expect(sessionContribution(null).size).toBe(0);
  });

  it("matches counting.ts for every student (parity with the live report)", () => {
    const sessions = [
      session({ subjectId: "maths" }, { s1: "PRESENT", s2: "ABSENT", s3: "ON_DUTY", s4: null }),
      session({ subjectId: "maths" }, { s1: "ABSENT", s2: "ABSENT" }),
      session({ subjectId: "phy" }, { s1: "PRESENT", s3: "PRESENT" }),
    ];
    const idx = indexSessions(sessions);
    for (const id of ["s1", "s2", "s3", "s4", "s9"]) {
      const live = tallyStudentBySubject(idx, id);
      const viaTally = new Map<string, [number, number]>();
      for (const s of sessions) {
        const c = sessionContribution(s).get(id);
        if (!c) continue;
        const cur = viaTally.get(s.subjectId) ?? [0, 0];
        viaTally.set(s.subjectId, [cur[0] + c[0], cur[1] + c[1]]);
      }
      expect(new Map([...viaTally].map(([k, [h, a]]) => [k, { held: h, attended: a }]))).toEqual(live);
    }
  });
});

describe("sessionTallyDelta", () => {
  it("a draft that is submitted adds the whole session", () => {
    const after = session({}, { s1: "PRESENT", s2: "ABSENT", s3: "ON_DUTY" });
    const d = sessionTallyDelta({ ...after, status: "DRAFT" }, after);
    expect(d.get("s1")).toEqual([1, 1]);
    expect(d.get("s2")).toEqual([1, 0]);
    expect(d.has("s3")).toBe(false);
  });

  it("a correction only moves the changed student", () => {
    const before = session({}, { s1: "ABSENT", s2: "PRESENT" });
    const after = session({}, { s1: "PRESENT", s2: "PRESENT" });
    const d = sessionTallyDelta(before, after);
    expect([...d.keys()]).toEqual(["s1"]);
    expect(d.get("s1")).toEqual([0, 1]);
  });

  it("releasing an on-duty student on a submitted session adds held (and attended if present)", () => {
    const before = session({}, { s1: "ON_DUTY" });
    expect(sessionTallyDelta(before, session({}, { s1: "ABSENT" })).get("s1")).toEqual([1, 0]);
    expect(sessionTallyDelta(before, session({}, { s1: "PRESENT" })).get("s1")).toEqual([1, 1]);
  });

  it("applying on-duty to a submitted session removes that period", () => {
    const before = session({}, { s1: "PRESENT" });
    expect(sessionTallyDelta(before, session({}, { s1: "ON_DUTY" })).get("s1")).toEqual([-1, -1]);
  });

  it("no change, no delta", () => {
    const s = session({}, { s1: "PRESENT" });
    expect(sessionTallyDelta(s, s).size).toBe(0);
  });
});

describe("tallySectionKey", () => {
  it("prefers the section id, falls back to name + year for legacy sessions", () => {
    expect(tallySectionKey({ sectionId: "abc", sectionName: "A", year: 2 })).toBe("abc");
    expect(tallySectionKey({ sectionName: "A", year: 2 })).toBe("n_A_2");
  });
});
