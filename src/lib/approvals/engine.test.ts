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
