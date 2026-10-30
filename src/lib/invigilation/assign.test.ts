import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DutySlot, FacultyDutyLock, InvigilationDuty, InvigilationRules, InvigilationSchedule } from "@/types/invigilation";
import { DEFAULT_INVIGILATION_RULES } from "./rules";
import type { CandidateFacts } from "./eligibility";

// The duty writes (assignDuty / changeDutyStatus) against a small in-memory
// Firestore: the lock docs keep counts right through assign, reassign and
// cancel, and a second duty at the same time is refused.

vi.mock("@/lib/notify", () => ({ notify: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/safeAuditLog", () => ({ writeAuditLogSafe: vi.fn(async () => true) }));

const store = new Map<string, Record<string, unknown>>();
let auto = 0;
function docRef(path: string) {
  return {
    path, id: path.split("/").pop()!,
    get: async () => snap(path),
    collection: (name: string) => col(`${path}/${name}`),
  };
}
function snap(path: string) {
  const data = store.get(path);
  return { exists: data !== undefined, id: path.split("/").pop()!, data: () => (data ? structuredClone(data) : undefined) };
}
function col(path: string) {
  return { doc: (id?: string) => docRef(`${path}/${id ?? `auto${++auto}`}`) };
}
const db = {
  collection: (name: string) => col(name),
  runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>) => {
    const writes: (() => void)[] = [];
    const tx = {
      get: async (ref: { path: string }) => snap(ref.path),
      set: (ref: { path: string }, data: Record<string, unknown>) => writes.push(() => store.set(ref.path, structuredClone(data))),
      update: (ref: { path: string }, data: Record<string, unknown>) => writes.push(() => store.set(ref.path, { ...(store.get(ref.path) ?? {}), ...structuredClone(data) })),
    };
    const out = await fn(tx);
    writes.forEach((w) => w());
    return out;
  },
};

const { assignDuty, changeDutyStatus } = await import("./assign");

const rules = (over: Partial<InvigilationRules> = {}): InvigilationRules => ({ ...DEFAULT_INVIGILATION_RULES, ...over });
const schedule = (r = rules()): InvigilationSchedule & { rules: InvigilationRules } => ({ id: "S", collegeId: "C", name: "Mid-1", midPlanIds: [], days: [], status: "ACTIVE", rules: r, publishedSessions: [], createdBy: "", createdByName: "" });
const slot = (room: string, from = "10:00", to = "11:30", required = 2): DutySlot => ({
  key: `2026-11-02|${from}-${to}|${room}`, session: `2026-11-02|${from}-${to}`, date: "2026-11-02", from, to, category: "INVIGILATOR",
  roomId: room, room: `Room ${room}`, block: "A", students: 48, required, subjects: [], groups: [], courseYears: [],
});
const fac = (id: string) => ({ id, employeeId: id.toUpperCase(), name: `Faculty ${id}`, department: "MECH", designation: "ASSISTANT_PROFESSOR", userUid: `u-${id}`, roles: [] });
const facts = (id: string): CandidateFacts => ({ facultyId: id, designation: "ASSISTANT_PROFESSOR", department: "MECH", classes: [], leave: [], hasTimetable: true, teachesNow: [], taughtBefore: [], duties: [] });
const actor = { uid: "exam", name: "Exam Cell" };
const lock = (f: string) => store.get(`colleges/C/invigilationFacultyLocks/S__${f}`) as unknown as FacultyDutyLock;
const duty = (id: string) => ({ ...(store.get(`colleges/C/invigilationDuties/${id}`) as unknown as InvigilationDuty), id });
const go = (s: DutySlot, f: string, extra: Partial<Parameters<typeof assignDuty>[2]> = {}) =>
  assignDuty(db as never, "C", { schedule: schedule(), slot: s, faculty: fac(f), facts: facts(f), sessions: [s.session], actor, ...extra });

beforeEach(() => { store.clear(); auto = 0; });

describe("assigning duties", () => {
  it("saves the duty and records it on the holder's lock and the slot", async () => {
    const d = await go(slot("201"), "f1");
    expect(d.status).toBe("DRAFT");
    expect(lock("f1").duties.map((x) => x.dutyId)).toEqual([d.id]);
    expect(store.get(`colleges/C/invigilationSlotLocks/S__${slot("201").key}`)?.dutyIds).toEqual([d.id]);
  });

  it("refuses the same person at an overlapping time in another room", async () => {
    await go(slot("201"), "f1");
    await expect(go(slot("202", "11:00", "12:30"), "f1")).rejects.toThrow(/Already on/);
  });

  it("refuses more people than the duty needs", async () => {
    await go(slot("201", "10:00", "11:30", 1), "f1");
    await expect(go(slot("201", "10:00", "11:30", 1), "f2")).rejects.toThrow(/already has its 1/);
  });

  it("a warning needs a reason AND a named approver", async () => {
    const r = rules({ limits: [{ designation: "", perSchedule: 1, mode: "WARN" }] });
    await assignDuty(db as never, "C", { schedule: schedule(r), slot: slot("201"), faculty: fac("f1"), facts: facts("f1"), sessions: [], actor });
    const second = { schedule: schedule(r), slot: slot("202", "14:00", "15:30"), faculty: fac("f1"), facts: facts("f1"), sessions: [], actor };
    await expect(assignDuty(db as never, "C", second)).rejects.toThrow(/Needs an override/);
    await expect(assignDuty(db as never, "C", { ...second, reason: "short of staff" })).rejects.toThrow(/approvers/);
    const ok = await assignDuty(db as never, "C", { ...second, schedule: schedule({ ...r, approverUids: ["exam"] }), reason: "short of staff" });
    expect(ok.overrides[0]).toMatchObject({ rule: "LIMIT_SCHEDULE", reason: "short of staff", byUid: "exam" });
  });

  it("a duty in a published session is published (and the holder is told)", async () => {
    const s = slot("201");
    const d = await assignDuty(db as never, "C", { schedule: { ...schedule(), publishedSessions: [s.session] }, slot: s, faculty: fac("f1"), facts: facts("f1"), sessions: [], actor });
    expect(d.status).toBe("PUBLISHED");
    expect(d.publishedAt).toBeTruthy();
  });
});

describe("reassigning and cancelling", () => {
  it("reassign: the old duty is kept as REASSIGNED, the slot still counts one person", async () => {
    const s = slot("201", "10:00", "11:30", 1);
    const first = await go(s, "f1");
    const second = await go(s, "f2", { replacing: { ...first } });
    expect(duty(first.id)).toMatchObject({ status: "REASSIGNED", replacedBy: second.id });
    expect(second.replaces).toBe(first.id);
    expect(store.get(`colleges/C/invigilationSlotLocks/S__${s.key}`)?.dutyIds).toEqual([second.id]);
    expect(lock("f1").duties[0].status).toBe("REASSIGNED");
    // f1 is free again at that time.
    await expect(go(slot("202", "10:00", "11:30"), "f1")).resolves.toBeTruthy();
  });

  it("cancel frees the place and the person's time; a cancelled duty can't be completed", async () => {
    const s = slot("201", "10:00", "11:30", 1);
    const d = await go(s, "f1");
    await changeDutyStatus(db as never, "C", d.id, "cancel", actor);
    expect(store.get(`colleges/C/invigilationSlotLocks/S__${s.key}`)?.dutyIds).toEqual([]);
    expect(lock("f1").duties[0].status).toBe("CANCELLED");
    await expect(go(s, "f2")).resolves.toBeTruthy();
    await expect(changeDutyStatus(db as never, "C", d.id, "complete", actor)).rejects.toThrow(/can't be completed/);
  });

  it("acknowledge only a published duty", async () => {
    const d = await go(slot("201"), "f1");
    await expect(changeDutyStatus(db as never, "C", d.id, "acknowledge", actor)).rejects.toThrow(/can't be acknowledged/);
  });
});
