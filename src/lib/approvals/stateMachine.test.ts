import { describe, expect, it } from "vitest";
import { approve, assertChain, cancel, currentStage, reject, revoke, skipStage, submit } from "./stateMachine";
import { ApprovalError } from "./types";

const actor = { uid: "u1", name: "Asha" };
const scope = (s: string) => (s === "HOD" ? "CSE" : "*");
const base = { id: "r1", kind: "k", collegeId: "c1", scope: "CSE", requesterUid: "s1", requesterName: "Ravi", requesterType: "STUDENT", payload: { x: 1 } };
const t = (n: number) => `2026-10-0${n}T00:00:00.000Z`;
const fresh = () => submit(base, ["HOD", "PRINCIPAL"], scope, actor, t(1));

describe("submit", () => {
  it("starts PENDING at the first stage with an inbox key and an audit entry", () => {
    const r = fresh();
    expect(r).toMatchObject({ status: "PENDING", stageIndex: 0, pendingKey: "HOD|CSE", version: 1, effectStatus: "NONE" });
    expect(r.history.map((h) => h.action)).toEqual(["SUBMIT"]);
    expect(currentStage(r)).toBe("HOD");
  });
  it("rejects an empty chain and a repeated stage", () => {
    expect(() => assertChain([])).toThrow(ApprovalError);
    expect(() => assertChain(["HOD", "HOD"])).toThrow(/repeat/);
  });
});

describe("approve", () => {
  it("advances stage by stage, re-keying the inbox, then finalises", () => {
    const r1 = approve(fresh(), actor, t(2), scope, "ok");
    expect(r1).toMatchObject({ status: "PENDING", stageIndex: 1, pendingKey: "PRINCIPAL|*", version: 2 });
    const r2 = approve(r1, actor, t(3), scope);
    expect(r2).toMatchObject({ status: "APPROVED", pendingKey: null, decidedAt: t(3), version: 3 });
    expect(currentStage(r2)).toBeNull();
    expect(r2.history.map((h) => [h.action, h.stage])).toEqual([["SUBMIT", undefined], ["APPROVE", "HOD"], ["APPROVE", "PRINCIPAL"]]);
  });
  it("cannot act on a finished request", () => {
    const done = approve(approve(fresh(), actor, t(2), scope), actor, t(3), scope);
    expect(() => approve(done, actor, t(4), scope)).toThrow(/no longer awaiting/);
  });
});

describe("reject / cancel / revoke / skip", () => {
  it("reject needs a reason and closes the request", () => {
    expect(() => reject(fresh(), actor, t(2), " ")).toThrow(/reason/);
    expect(reject(fresh(), actor, t(2), "Clashes with exams")).toMatchObject({ status: "REJECTED", pendingKey: null, decidedAt: t(2) });
  });
  it("cancel only works while pending", () => {
    const c = cancel(fresh(), { uid: "s1", name: "Ravi" }, t(2));
    expect(c).toMatchObject({ status: "CANCELLED", pendingKey: null });
    expect(() => cancel(c, actor, t(3))).toThrow(ApprovalError);
  });
  it("revoke only applies to an approved request and needs a reason", () => {
    expect(() => revoke(fresh(), actor, t(2), "x")).toThrow(/approved/);
    const done = approve(approve(fresh(), actor, t(2), scope), actor, t(3), scope);
    expect(() => revoke(done, actor, t(4), "")).toThrow(/reason/);
    expect(revoke(done, actor, t(4), "Event cancelled")).toMatchObject({ status: "REVOKED", pendingKey: null });
  });
  it("skipStage moves on and records why; skipping the last stage approves", () => {
    const s1 = skipStage(fresh(), actor, t(2), scope, "No approver assigned");
    expect(s1).toMatchObject({ stageIndex: 1, pendingKey: "PRINCIPAL|*" });
    expect(s1.history[s1.history.length - 1]).toMatchObject({ action: "SKIP", stage: "HOD", remark: "No approver assigned" });
    expect(skipStage(s1, actor, t(3), scope, "none").status).toBe("APPROVED");
  });
  it("never mutates its input", () => {
    const r = fresh();
    const snapshot = JSON.stringify(r);
    approve(r, actor, t(2), scope); reject(r, actor, t(2), "no"); cancel(r, actor, t(2));
    expect(JSON.stringify(r)).toBe(snapshot);
  });
});
