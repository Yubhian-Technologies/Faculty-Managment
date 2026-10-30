import { describe, expect, it } from "vitest";
import type { DutyRef, DutySlot, InvigilationRules } from "@/types/invigilation";
import { cleanRules, DEFAULT_INVIGILATION_RULES, invigilatorsFor, limitFor, relieversFor } from "./rules";
import { buildSlots, sessionOrder, type ExamOfGroup } from "./slots";
import { evaluate, freeParts, rankCandidates, workload, type CandidateFacts } from "./eligibility";

const R = (over: Partial<InvigilationRules> = {}): InvigilationRules => ({ ...DEFAULT_INVIGILATION_RULES, ...over });
const slot = (over: Partial<DutySlot> = {}): DutySlot => ({
  key: "2026-11-02|10:00-11:30|r201", session: "2026-11-02|10:00-11:30", date: "2026-11-02", from: "10:00", to: "11:30",
  category: "INVIGILATOR", roomId: "r201", room: "Block A, Floor 2, Room 201", block: "A", students: 48, required: 2,
  subjects: [{ id: "dbms", code: "CS301", name: "DBMS" }], groups: ["CSE (2nd Year)"], courseYears: [], ...over,
});
const facts = (over: Partial<CandidateFacts> = {}): CandidateFacts => ({
  facultyId: "f1", designation: "ASSISTANT_PROFESSOR", department: "Mechanical Engineering",
  classes: [], leave: [], hasTimetable: true, teachesNow: [], taughtBefore: [], duties: [], ...over,
});
const duty = (over: Partial<DutyRef>): DutyRef => ({ dutyId: "d", slotKey: "x", date: "2026-11-02", from: "14:00", to: "15:30", category: "INVIGILATOR", status: "DRAFT", ...over });
const rules = (issues: { rule: string }[]) => issues.map((i) => i.rule);

describe("configuration", () => {
  it("cleans numbers and refuses min above max", () => {
    const { rules: r, errors } = cleanRules({ minPerRoom: 3, maxPerRoom: 2, studentsPerInvigilator: "abc" });
    expect(errors[0]).toMatch(/Minimum/);
    expect(r.studentsPerInvigilator).toBe(30);
  });
  it("one limit row per designation, matched loosely", () => {
    const { rules: r, errors } = cleanRules({ limits: [{ designation: "Professor", perSchedule: 1, mode: "HARD" }, { designation: "", perSchedule: 4, mode: "WARN" }, { designation: "PROFESSOR", perSchedule: 2, mode: "HARD" }] });
    expect(errors).toEqual(["PROFESSOR has two limit rows"]);
    expect(limitFor("PROFESSOR", r)?.perSchedule).toBe(1);
    expect(limitFor("ASSISTANT_PROFESSOR", r)?.perSchedule).toBe(4);
  });
  it("people needed: by students, within min / max; relievers by rooms", () => {
    const r = R();
    expect(invigilatorsFor(24, r)).toBe(1);
    expect(invigilatorsFor(48, r)).toBe(2);
    expect(invigilatorsFor(90, r)).toBe(2);
    expect(invigilatorsFor(0, r)).toBe(0);
    expect(relieversFor(11, r)).toBe(3);
  });
});

describe("duty slots", () => {
  it("a room per session for the branches writing then, plus relievers and squad per session", () => {
    const cse: ExamOfGroup[] = [{ date: "2026-11-02", from: "10:00", to: "11:30", subjects: [{ id: "m1", code: "MA101", name: "Maths" }], courseIds: ["c1"], year: 1, semester: 1 }];
    const ece: ExamOfGroup[] = [{ date: "2026-11-02", from: "10:00", to: "11:30", subjects: [{ id: "p1", code: "PH101", name: "Physics" }], courseIds: ["c2"], year: 1, semester: 1 }];
    const slots = buildSlots(new Map([["CSE", cse], ["ECE", ece]]), [{ roomId: "r1", name: "201", block: "A", floor: 2, groups: { CSE: 24, ECE: 24 } }], R());
    const room = slots.find((s) => s.category === "INVIGILATOR")!;
    expect(room.students).toBe(48);
    expect(room.required).toBe(2);
    expect(room.subjects.map((s) => s.id).sort()).toEqual(["m1", "p1"]);
    expect(slots.find((s) => s.category === "RELIEVER")!.required).toBe(1);
    expect(slots.find((s) => s.category === "SQUAD")!.required).toBe(2);
    expect(sessionOrder(slots)).toEqual(["2026-11-02|10:00-11:30"]);
  });
  it("a branch not writing that day leaves the room's count", () => {
    const cse: ExamOfGroup[] = [{ date: "2026-11-03", from: "10:00", to: "11:30", subjects: [], courseIds: [], year: 1, semester: 1 }];
    const slots = buildSlots(new Map([["CSE", cse], ["ECE", []]]), [{ roomId: "r1", name: "201", block: "A", floor: 2, groups: { CSE: 24, ECE: 24 } }], R());
    expect(slots.find((s) => s.category === "INVIGILATOR")!.students).toBe(24);
  });
});

describe("eligibility", () => {
  it("free person, nothing in the way", () => {
    expect(evaluate(slot(), facts(), R(), { sessions: [], filled: 0 }).availability).toBe("AVAILABLE");
  });
  it("a class during the exam blocks, and shows the free part", () => {
    const e = evaluate(slot(), facts({ classes: [{ from: "10:50", to: "11:40", label: "ECE II-A" }] }), R({ bufferMinutes: 0 }), { sessions: [], filled: 0 });
    expect(e.availability).toBe("BUSY");
    expect(e.freeRanges).toEqual([{ from: "10:00", to: "10:50" }]);
  });
  it("buffer: a class ending at 10:00 blocks a 10:00 exam when 10 minutes are needed", () => {
    expect(rules(evaluate(slot(), facts({ classes: [{ from: "09:10", to: "10:00", label: "" }] }), R({ bufferMinutes: 10 }), { sessions: [], filled: 0 }).issues)).toContain("CLASS");
    expect(rules(evaluate(slot(), facts({ classes: [{ from: "09:10", to: "10:00", label: "" }] }), R({ bufferMinutes: 0 }), { sessions: [], filled: 0 }).issues)).not.toContain("CLASS");
  });
  it("another duty at an overlapping time is hard; a cancelled one is not", () => {
    const busy = facts({ duties: [duty({ from: "10:00", to: "12:00" })] });
    expect(evaluate(slot(), busy, R(), { sessions: [], filled: 0 }).availability).toBe("ON_DUTY");
    const cancelled = facts({ duties: [duty({ from: "10:00", to: "12:00", status: "CANCELLED" })] });
    expect(evaluate(slot(), cancelled, R(), { sessions: [], filled: 0 }).availability).toBe("AVAILABLE");
  });
  it("teaching the subject being written is hard; taught before only when configured", () => {
    expect(evaluate(slot(), facts({ teachesNow: ["dbms"] }), R(), { sessions: [], filled: 0 }).availability).toBe("SUBJECT");
    expect(evaluate(slot(), facts({ taughtBefore: ["dbms"] }), R(), { sessions: [], filled: 0 }).availability).toBe("AVAILABLE");
    expect(evaluate(slot(), facts({ taughtBefore: ["dbms"] }), R({ excludePastSubjectFaculty: true }), { sessions: [], filled: 0 }).availability).toBe("SUBJECT");
  });
  it("leave and missing timetable", () => {
    expect(evaluate(slot(), facts({ leave: [{ from: "00:00", to: "24:00", label: "CL" }] }), R(), { sessions: [], filled: 0 }).availability).toBe("ON_LEAVE");
    expect(evaluate(slot(), facts({ hasTimetable: false }), R(), { sessions: [], filled: 0 }).availability).toBe("NO_TIMETABLE");
    expect(evaluate(slot(), facts({ hasTimetable: false }), R({ missingTimetable: "ALLOW" }), { sessions: [], filled: 0 }).availability).toBe("AVAILABLE");
  });
  it("designation limits: hard or warning, per schedule / day / category", () => {
    const two = [duty({ dutyId: "a", slotKey: "a", date: "2026-11-01" }), duty({ dutyId: "b", slotKey: "b", date: "2026-11-02" })];
    const hard = R({ limits: [{ designation: "ASSISTANT_PROFESSOR", perSchedule: 2, mode: "HARD" }] });
    const e = evaluate(slot(), facts({ duties: two }), hard, { sessions: [], filled: 0 });
    expect(e.issues.find((i) => i.rule === "LIMIT_SCHEDULE")?.level).toBe("HARD");
    const warn = R({ limits: [{ designation: "", perDay: 1, mode: "WARN" }] });
    const w = evaluate(slot(), facts({ duties: two }), warn, { sessions: [], filled: 0 });
    expect(w.availability).toBe("NEEDS_OVERRIDE");
    expect(rules(w.issues)).toEqual(["LIMIT_DAY"]);
    const cat = R({ limits: [{ designation: "", byCategory: { INVIGILATOR: 2 }, mode: "HARD" }] });
    expect(rules(evaluate(slot(), facts({ duties: two }), cat, { sessions: [], filled: 0 }).issues)).toContain("LIMIT_CATEGORY");
  });
  it("only the counted categories count towards limits", () => {
    const r = R({ countCategories: ["INVIGILATOR"], limits: [{ designation: "", perSchedule: 1, mode: "HARD" }] });
    const squadOnly = facts({ duties: [duty({ category: "SQUAD", date: "2026-11-01" })] });
    expect(evaluate(slot(), squadOnly, r, { sessions: [], filled: 0 }).availability).toBe("AVAILABLE");
  });
  it("room rotation: same room again, and in the session next to it", () => {
    const sessions = ["2026-11-01|10:00-11:30", "2026-11-02|10:00-11:30"];
    const had = facts({ duties: [duty({ slotKey: "s1", date: "2026-11-01", from: "10:00", to: "11:30", roomId: "r201" })] });
    const e = evaluate(slot(), had, R(), { sessions, filled: 0 });
    expect(rules(e.issues).sort()).toEqual(["CONSECUTIVE_ROOM", "SAME_ROOM"]);
    expect(evaluate(slot(), had, R({ sameRoomRule: "OFF", consecutiveSameRoomRule: "HARD" }), { sessions, filled: 0 }).issues.map((i) => i.level)).toEqual(["HARD"]);
  });
  it("reassignment: the duty being replaced doesn't count against the new one", () => {
    const own = facts({ duties: [duty({ dutyId: "old", slotKey: "2026-11-02|10:00-11:30|r201", from: "10:00", to: "11:30", roomId: "r201" })] });
    expect(evaluate(slot(), own, R(), { sessions: [], filled: 0 }).availability).toBe("ON_DUTY");
    expect(evaluate(slot(), own, R(), { sessions: [], filled: 0, replacing: "old" }).availability).toBe("AVAILABLE");
  });
  it("a full slot refuses more people but doesn't mark the person", () => {
    const e = evaluate(slot({ required: 1 }), facts(), R(), { sessions: [], filled: 1 });
    expect(e.issues[0]).toMatchObject({ rule: "FULL", level: "HARD" });
    expect(e.availability).toBe("AVAILABLE");
  });
});

describe("workload and fairness", () => {
  it("counts once per duty; cancelled and reassigned kept apart", () => {
    const w = workload([duty({ status: "PUBLISHED" }), duty({ status: "COMPLETED", category: "SQUAD" }), duty({ status: "REASSIGNED" }), duty({ status: "CANCELLED" })], ["INVIGILATOR", "RELIEVER", "SQUAD"], "2026-11-02");
    expect(w).toMatchObject({ total: 2, completed: 1, cancelled: 1, reassigned: 1, onDate: 2 });
    expect(w.byCategory).toEqual({ INVIGILATOR: 1, RELIEVER: 0, SQUAD: 1 });
  });
  it("suggests the least loaded available people first", () => {
    const ok = { availability: "AVAILABLE" as const, issues: [] };
    const list = [
      { facultyId: "a", name: "A", evaluation: ok, duties: [duty({}), duty({ date: "2026-11-01" })] },
      { facultyId: "b", name: "B", evaluation: ok, duties: [] },
      { facultyId: "c", name: "C", evaluation: { availability: "BUSY" as const, issues: [] }, duties: [] },
    ];
    expect(rankCandidates(list, slot(), R()).map((x) => x.facultyId)).toEqual(["b", "a", "c"]);
  });
  it("free parts of a window", () => {
    expect(freeParts("10:00", "12:00", [{ from: "10:30", to: "11:00" }])).toEqual([{ from: "10:00", to: "10:30" }, { from: "11:00", to: "12:00" }]);
  });
});
