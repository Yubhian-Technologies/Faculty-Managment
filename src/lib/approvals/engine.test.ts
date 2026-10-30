import { describe, expect, it, vi } from "vitest";
import { createApprovalEngine } from "./engine";
import { createMemoryStore } from "./memoryStore";
import type { ApprovalKind } from "./ports";
import { ApprovalError } from "./types";

type P = { what: string };
type Ctx = { approvers: Record<string, string[]>; actionable?: (stage: string) => boolean };
const calls: string[] = [];

function setup(overrides: Partial<ApprovalKind<P, Ctx, { marker: "memory-tx" }>> = {}) {
  calls.length = 0;
  const store = createMemoryStore();
  const kind: ApprovalKind<P, Ctx, { marker: "memory-tx" }> = {
    kind: "demo",
    stageScope: (stage, req) => (stage === "HOD" ? req.scope : "*"),
    canDecide: async (ctx, _req, stage, actor) => (ctx.approvers[stage] ?? []).includes(actor.uid),
    isStageActionable: async (ctx, _req, stage) => ctx.actionable?.(stage) ?? true,
    applyInTransaction: (_tx, _ctx, _req, change) => { calls.push(`tx:${change}`); },
    afterApproved: async () => { calls.push("after:approved"); },
    afterRevoked: async () => { calls.push("after:revoked"); },
    ...overrides,
  };
  const events: string[] = [];
  let n = 0;
  const engine = createApprovalEngine<P, Ctx, { marker: "memory-tx" }>({
    kind, store, newId: () => `r${++n}`, onEvent: (_c, e) => { events.push(e); },
  });
  const ctx: Ctx = { approvers: { HOD: ["hod1"], PRINCIPAL: ["pri1"], CLASS_INCHARGE: ["ci1"] } };
  const raise = (chain = ["HOD", "PRINCIPAL"], c: Ctx = ctx) =>
    engine.submit(c, { collegeId: "c1", scope: "CSE", requester: { uid: "stu1", name: "Ravi", type: "STUDENT" }, payload: { what: "hackathon" }, chain });
  return { engine, store, ctx, events, raise };
}
const hod = { uid: "hod1", name: "HOD" };
const pri = { uid: "pri1", name: "Principal" };

describe("engine: happy path", () => {
  it("routes through every stage, runs effects once at the end, and emits events", async () => {
    const { engine, ctx, events, raise, store } = setup();
    const r = await raise();
    expect(r.pendingKey).toBe("HOD|CSE");
    const a = await engine.decide(ctx, { collegeId: "c1", id: r.id, actor: hod, decision: "APPROVE" });
    expect(a).toMatchObject({ status: "PENDING", pendingKey: "PRINCIPAL|*", effectStatus: "NONE" });
    expect(calls).toEqual([]); // no effects until fully approved
    const done = await engine.decide(ctx, { collegeId: "c1", id: r.id, actor: pri, decision: "APPROVE", remark: "go" });
    expect(done).toMatchObject({ status: "APPROVED", effectStatus: "APPLIED", pendingKey: null });
    expect(calls).toEqual(["tx:APPROVED", "after:approved"]);
    expect(events).toEqual(["SUBMITTED", "ADVANCED", "APPROVED"]);
    expect((await store.get("c1", r.id))!.version).toBeGreaterThan(done.version - 1);
  });
});

describe("engine: completeAll (overseer approval)", () => {
  it("closes the request on the first approval - the stages above are not asked - and runs the effects once", async () => {
    const { engine, ctx, raise } = setup();
    const r = await raise(["HOD", "PRINCIPAL"]);
    ctx.approvers.HOD.push("pri1");
    const done = await engine.decide(ctx, { collegeId: "c1", id: r.id, actor: pri, decision: "APPROVE", completeAll: true });
    expect(done).toMatchObject({ status: "APPROVED", pendingKey: null, effectStatus: "APPLIED" });
    expect(done.history.filter((h) => h.action === "APPROVE").map((h) => h.stage)).toEqual(["HOD"]);
    expect(calls).toEqual(["tx:APPROVED", "after:approved"]);
  });
});

describe("engine: escalation after a stage's hours", () => {
  function clocked() {
    let now = new Date("2026-10-05T09:00:00.000Z");
    const s = setup();
    let n = 0;
    const events: string[] = [];
    const engine = createApprovalEngine<P, Ctx, { marker: "memory-tx" }>({
      kind: { kind: "demo", stageScope: (st, req) => (st === "HOD" ? req.scope : "*"), canDecide: async (c, _r, st, a) => (c.approvers[st] ?? []).includes(a.uid), completesAllOnApprove: () => true },
      store: s.store, now: () => now, newId: () => `e${++n}`, onEvent: (_c, e) => { events.push(e); },
    });
    const ctx: Ctx = { approvers: { HOD: ["hod1"], VICE_PRINCIPAL: ["vp1"], PRINCIPAL: ["pri1"] } };
    const raise = (stageHours: (number | null)[] = [24, 24, null]) =>
      engine.submit(ctx, { collegeId: "c1", scope: "CSE", requester: { uid: "stu1", name: "Ravi", type: "STUDENT" }, payload: { what: "x" }, chain: ["HOD", "VICE_PRINCIPAL", "PRINCIPAL"], stageHours });
    return { engine, ctx, events, raise, store: s.store, advance: (h: number) => { now = new Date(now.getTime() + h * 3_600_000); } };
  }

  it("moves an unanswered request up a level once its hours pass, and not before", async () => {
    const { engine, ctx, raise, advance, events, store } = clocked();
    const r = await raise();
    expect(r.escalateAt).toBe("2026-10-06T09:00:00.000Z");
    advance(23);
    expect(await engine.escalateOverdue(ctx, { collegeId: "c1" })).toEqual([]);
    advance(2);
    expect(await engine.escalateOverdue(ctx, { collegeId: "c1" })).toEqual([r.id]);
    const moved = (await store.get<P>("c1", r.id))!;
    expect(moved).toMatchObject({ status: "PENDING", pendingKey: "VICE_PRINCIPAL|*", stageIndex: 1 });
    expect(moved.history.at(-1)).toMatchObject({ action: "ESCALATE", stage: "HOD", actorUid: "system" });
    expect(moved.escalateAt).toBe("2026-10-07T10:00:00.000Z"); // a fresh 24h from the moment it moved
    expect(events).toEqual(["SUBMITTED", "ESCALATED"]);
  });

  it("is idempotent: a second sweep right after changes nothing", async () => {
    const { engine, ctx, raise, advance } = clocked();
    await raise();
    advance(25);
    expect((await engine.escalateOverdue(ctx, { collegeId: "c1" })).length).toBe(1);
    expect(await engine.escalateOverdue(ctx, { collegeId: "c1" })).toEqual([]);
  });

  it("climbs one level at a time and stops at the last level, which has nobody above it", async () => {
    const { engine, ctx, raise, advance, store } = clocked();
    const r = await raise([24, 24, 24]);
    advance(25); await engine.escalateOverdue(ctx, { collegeId: "c1" });
    advance(25); await engine.escalateOverdue(ctx, { collegeId: "c1" });
    const top = (await store.get<P>("c1", r.id))!;
    expect(top).toMatchObject({ pendingKey: "PRINCIPAL|*", escalateAt: null });
    advance(500);
    expect(await engine.escalateOverdue(ctx, { collegeId: "c1" })).toEqual([]);
  });

  it("an approval after escalating is by the level it now waits at, and it closes the request", async () => {
    const { engine, ctx, raise, advance } = clocked();
    const r = await raise();
    advance(25); await engine.escalateOverdue(ctx, { collegeId: "c1" });
    await expect(engine.decide(ctx, { collegeId: "c1", id: r.id, actor: { uid: "hod1", name: "HOD" }, decision: "APPROVE" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const done = await engine.decide(ctx, { collegeId: "c1", id: r.id, actor: { uid: "vp1", name: "VP" }, decision: "APPROVE" });
    expect(done).toMatchObject({ status: "APPROVED", escalateAt: null, pendingKey: null });
    advance(500);
    expect(await engine.escalateOverdue(ctx, { collegeId: "c1" })).toEqual([]);
  });

  it("a rejection closes it too and stops the clock", async () => {
    const { engine, ctx, raise, advance } = clocked();
    const r = await raise();
    const done = await engine.decide(ctx, { collegeId: "c1", id: r.id, actor: { uid: "hod1", name: "HOD" }, decision: "REJECT", remark: "no" });
    expect(done).toMatchObject({ status: "REJECTED", escalateAt: null });
    advance(100);
    expect(await engine.escalateOverdue(ctx, { collegeId: "c1" })).toEqual([]);
  });

  it("a stage with no hours never escalates", async () => {
    const { engine, ctx, raise, advance } = clocked();
    const r = await raise([null, null, null]);
    expect(r.escalateAt).toBeNull();
    advance(1000);
    expect(await engine.escalateOverdue(ctx, { collegeId: "c1" })).toEqual([]);
  });
});

describe("engine: authorisation", () => {
  it("only the stage's approver may decide - not another stage's, not the requester", async () => {
    const { engine, ctx, raise } = setup();
    const r = await raise();
    for (const actor of [pri, { uid: "stu1", name: "Ravi" }, { uid: "nobody", name: "X" }]) {
      await expect(engine.decide(ctx, { collegeId: "c1", id: r.id, actor, decision: "APPROVE" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  it("a decided request can't be decided again", async () => {
    const { engine, ctx, raise } = setup();
    const r = await raise(["HOD"]);
    await engine.decide(ctx, { collegeId: "c1", id: r.id, actor: hod, decision: "APPROVE" });
    await expect(engine.decide(ctx, { collegeId: "c1", id: r.id, actor: hod, decision: "APPROVE" })).rejects.toMatchObject({ code: "NOT_PENDING" });
  });
  it("only the requester can withdraw, and only while pending", async () => {
    const { engine, ctx, raise } = setup();
    const r = await raise();
    await expect(engine.cancel(ctx, { collegeId: "c1", id: r.id, actor: hod })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const c = await engine.cancel(ctx, { collegeId: "c1", id: r.id, actor: { uid: "stu1", name: "Ravi" } });
    expect(c.status).toBe("CANCELLED");
    await expect(engine.cancel(ctx, { collegeId: "c1", id: r.id, actor: { uid: "stu1", name: "Ravi" } })).rejects.toMatchObject({ code: "NOT_PENDING" });
  });
});

describe("engine: rejection", () => {
  it("rejects with a reason and runs no effects", async () => {
    const { engine, ctx, raise, events } = setup();
    const r = await raise();
    await expect(engine.decide(ctx, { collegeId: "c1", id: r.id, actor: hod, decision: "REJECT" })).rejects.toMatchObject({ code: "REMARK_REQUIRED" });
    const x = await engine.decide(ctx, { collegeId: "c1", id: r.id, actor: hod, decision: "REJECT", remark: "Exam week" });
    expect(x).toMatchObject({ status: "REJECTED", pendingKey: null });
    expect(calls).toEqual([]);
    expect(events).toContain("REJECTED");
  });
});

describe("engine: unactionable stages", () => {
  it("skips a non-final stage nobody can act on, noting it in the audit trail", async () => {
    const { raise } = setup();
    const r = await raise(["CLASS_INCHARGE", "HOD"], { approvers: { HOD: ["hod1"] }, actionable: (s) => s !== "CLASS_INCHARGE" });
    expect(r.pendingKey).toBe("HOD|CSE");
    expect(r.history.map((h) => h.action)).toEqual(["SUBMIT", "SKIP"]);
  });
  it("never skips the final stage (it waits there instead of auto-approving)", async () => {
    const { raise } = setup();
    const r = await raise(["HOD"], { approvers: { HOD: [] }, actionable: () => false });
    expect(r).toMatchObject({ status: "PENDING", pendingKey: "HOD|CSE" });
  });
  it("skips again after an approval when the next stage is unactionable", async () => {
    const { engine, raise } = setup();
    const c = { approvers: { CLASS_INCHARGE: ["ci1"], HOD: ["hod1"], PRINCIPAL: ["pri1"] }, actionable: (s: string) => s !== "HOD" };
    const r = await raise(["CLASS_INCHARGE", "HOD", "PRINCIPAL"], c);
    const a = await engine.decide(c, { collegeId: "c1", id: r.id, actor: { uid: "ci1", name: "CI" }, decision: "APPROVE" });
    expect(a.pendingKey).toBe("PRINCIPAL|*");
  });
});

describe("engine: effects and revoke", () => {
  it("revoke needs the final-stage approver, a reason, and undoes the effects", async () => {
    const { engine, ctx, raise } = setup();
    const r = await raise(["HOD"]);
    await engine.decide(ctx, { collegeId: "c1", id: r.id, actor: hod, decision: "APPROVE" });
    calls.length = 0;
    await expect(engine.revoke(ctx, { collegeId: "c1", id: r.id, actor: pri, remark: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(engine.revoke(ctx, { collegeId: "c1", id: r.id, actor: hod, remark: "" })).rejects.toMatchObject({ code: "REMARK_REQUIRED" });
    const v = await engine.revoke(ctx, { collegeId: "c1", id: r.id, actor: hod, remark: "Event cancelled" });
    expect(v).toMatchObject({ status: "REVOKED", effectStatus: "APPLIED" });
    expect(calls).toEqual(["tx:REVOKED", "after:revoked"]);
  });
  it("a failing after-commit effect keeps the approval, marks effects FAILED, and can be retried", async () => {
    let fail = true;
    const { engine, ctx, raise, store } = setup({ afterApproved: async () => { if (fail) throw new Error("boom"); calls.push("after:ok"); } });
    const r = await raise(["HOD"]);
    const done = await engine.decide(ctx, { collegeId: "c1", id: r.id, actor: hod, decision: "APPROVE" });
    expect(done).toMatchObject({ status: "APPROVED", effectStatus: "FAILED", effectError: "boom" });
    fail = false;
    const retried = await engine.retryEffects(ctx, { collegeId: "c1", id: r.id });
    expect(retried.effectStatus).toBe("APPLIED");
    expect((await store.get("c1", r.id))!.effectStatus).toBe("APPLIED");
    expect(await engine.retryEffects(ctx, { collegeId: "c1", id: r.id })).toMatchObject({ effectStatus: "APPLIED" }); // no-op when applied
  });
  it("a notification failure never breaks the workflow", async () => {
    const store = createMemoryStore();
    const kind: ApprovalKind<P, Ctx, { marker: "memory-tx" }> = { kind: "demo", stageScope: () => "*", canDecide: async () => true };
    const engine = createApprovalEngine<P, Ctx, { marker: "memory-tx" }>({ kind, store, onEvent: () => { throw new Error("smtp down"); } });
    const r = await engine.submit({ approvers: {} }, { collegeId: "c1", scope: "x", requester: { uid: "u", name: "U", type: "T" }, payload: { what: "a" }, chain: ["HOD"] });
    expect(r.status).toBe("PENDING");
  });
});

describe("store contract (memory reference)", () => {
  it("rejects a stale write (optimistic concurrency) and a duplicate create", async () => {
    const { engine, ctx, raise, store } = setup();
    const r = await raise(["HOD"]);
    // A concurrent writer bumps the version while a decision is in flight.
    const spy = vi.spyOn(store, "get");
    spy.mockRestore();
    const racing = store.update<P, void>("c1", r.id, async (cur) => {
      await store.update<P, void>("c1", r.id, async (c2) => ({ next: { ...c2, version: c2.version + 1 }, result: undefined }));
      return { next: { ...cur, version: cur.version + 1 }, result: undefined };
    });
    await expect(racing).rejects.toBeInstanceOf(ApprovalError);
    await expect(store.create(r)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(engine).toBeDefined(); expect(ctx).toBeDefined();
  });
  it("lists newest first with cursor paging, by inbox key, requester and scope", async () => {
    const { raise, store } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) { ids.push((await raise()).id); await new Promise((r) => setTimeout(r, 3)); }
    const inbox = await store.listByPendingKeys("c1", "demo", ["HOD|CSE"], { limit: 2 });
    expect(inbox.map((r) => r.id)).toEqual([ids[2], ids[1]]);
    const next = await store.listByPendingKeys("c1", "demo", ["HOD|CSE"], { before: inbox[1].createdAt });
    expect(next.map((r) => r.id)).toEqual([ids[0]]);
    expect(await store.listByRequester("c1", "demo", "stu1")).toHaveLength(3);
    expect(await store.listByScope("c1", "demo", ["CSE"])).toHaveLength(3);
    expect(await store.listByScope("c1", "demo", ["ECE"])).toHaveLength(0);
    expect(await store.listByPendingKeys("c2", "demo", ["HOD|CSE"])).toHaveLength(0);
  });
});

describe("engine: withdrawing on someone's behalf, and revoking too late", () => {
  it("an approver the kind allows can withdraw a stuck request, but only with a reason; others still can't", async () => {
    const { engine, ctx, raise } = setup({ canCancel: async (_c, _r, actor) => actor.uid === "hod1" });
    const r = await raise();
    await expect(engine.cancel(ctx, { collegeId: "c1", id: r.id, actor: pri })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(engine.cancel(ctx, { collegeId: "c1", id: r.id, actor: hod })).rejects.toMatchObject({ code: "REMARK_REQUIRED" });
    const c = await engine.cancel(ctx, { collegeId: "c1", id: r.id, actor: hod, remark: "Student left the college" });
    expect(c).toMatchObject({ status: "CANCELLED", pendingKey: null });
    expect(c.history.at(-1)).toMatchObject({ action: "CANCEL", actorUid: "hod1", remark: "Student left the college" });
  });

  it("a revoke the kind blocks is refused with its reason, and nothing changes", async () => {
    const { engine, ctx, raise } = setup({ revokeBlockedReason: () => "Already started" });
    const r = await raise(["HOD"]);
    await engine.decide(ctx, { collegeId: "c1", id: r.id, actor: hod, decision: "APPROVE" });
    await expect(engine.revoke(ctx, { collegeId: "c1", id: r.id, actor: hod, remark: "oops" })).rejects.toMatchObject({ code: "INVALID", message: "Already started" });
  });
});
