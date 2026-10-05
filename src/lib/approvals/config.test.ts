import { describe, expect, it } from "vitest";
import { applyConfigEdit, emptyConfig, isTypeDisabled, resolveLimits, resolveRoute, sanitizeRuleSet, type KindConfig } from "./config";
import { ApprovalError } from "./types";

const allowed = (t: string) => (t === "STUDENT" ? ["CLASS_INCHARGE", "HOD", "VICE_PRINCIPAL", "PRINCIPAL"] : ["HOD", "VICE_PRINCIPAL", "PRINCIPAL"]);
const fallback = (t: string) => (t === "STUDENT" ? ["HOD"] : ["HOD", "PRINCIPAL"]);
type L = { maxDays: number; proofRequired: boolean };

const cfg: KindConfig<L> = {
  enabled: true,
  college: { routes: { STUDENT: { "*": ["HOD", "PRINCIPAL"], certifications: ["HOD"] } }, limits: { maxDays: 5 } },
  departments: {
    CSE: { hodCanConfigure: true, override: { routes: { STUDENT: { nptel: ["CLASS_INCHARGE", "HOD"], "*": ["PRINCIPAL"] } }, limits: { maxDays: 2 }, disabledTypes: ["sports"] } },
    ECE: { hodCanConfigure: false },
  },
};
const q = (department: string, requesterType = "STUDENT", typeKeys: string[] = ["nptel", "certifications"]) => ({ department, requesterType, typeKeys });

describe("resolveRoute", () => {
  it("prefers the department's item-level route, then its catch-all, then the college's, then the default", () => {
    expect(resolveRoute(cfg, fallback, q("CSE"))).toEqual(["CLASS_INCHARGE", "HOD"]);
    expect(resolveRoute(cfg, fallback, q("CSE", "STUDENT", ["hackathon", "external"]))).toEqual(["PRINCIPAL"]);
    expect(resolveRoute(cfg, fallback, q("ECE"))).toEqual(["HOD"]); // college: certifications group
    expect(resolveRoute(cfg, fallback, q("ECE", "STUDENT", ["hackathon"]))).toEqual(["HOD", "PRINCIPAL"]); // college "*"
    expect(resolveRoute(cfg, fallback, q("ECE", "FACULTY"))).toEqual(["HOD", "PRINCIPAL"]); // built-in default
    expect(resolveRoute(undefined, fallback, q("CSE"))).toEqual(["HOD"]);
  });
  it("returns a copy, never the stored array", () => {
    const r = resolveRoute(cfg, fallback, q("ECE"));
    r.push("X");
    expect(cfg.college.routes!.STUDENT.certifications).toEqual(["HOD"]);
  });
});

describe("resolveLimits / isTypeDisabled", () => {
  it("layers defaults <- college <- department", () => {
    const d = { maxDays: 30, proofRequired: true };
    expect(resolveLimits(cfg, d, "CSE")).toEqual({ maxDays: 2, proofRequired: true });
    expect(resolveLimits(cfg, d, "ECE")).toEqual({ maxDays: 5, proofRequired: true });
    expect(resolveLimits(undefined, d, "CSE")).toEqual(d);
  });
  it("checks college and department switches", () => {
    expect(isTypeDisabled(cfg, "CSE", ["sports"])).toBe(true);
    expect(isTypeDisabled(cfg, "ECE", ["sports"])).toBe(false);
  });
});

describe("sanitizeRuleSet", () => {
  it("drops empty routes and rejects stages not allowed for that requester type", () => {
    expect(sanitizeRuleSet({ routes: { STUDENT: { a: [], b: ["HOD"] } } }, allowed)).toEqual({ routes: { STUDENT: { b: ["HOD"] } } });
    expect(() => sanitizeRuleSet({ routes: { FACULTY: { "*": ["CLASS_INCHARGE"] } } }, allowed)).toThrow(/valid stage/);
    expect(() => sanitizeRuleSet({ routes: { STUDENT: { "*": ["HOD", "HOD"] } } }, allowed)).toThrow(/repeat/);
  });
});

describe("applyConfigEdit", () => {
  const principal = { role: "PRINCIPAL" as const };
  const hodCse = { role: "HOD" as const, departments: ["CSE"] };
  const edit = (c: KindConfig<L>, mut: (x: KindConfig<L>) => void) => { const n = structuredClone(c); mut(n); return n; };
  const expectForbidden = (fn: () => unknown) => { try { fn(); throw new Error("did not throw"); } catch (e) { expect(e).toBeInstanceOf(ApprovalError); expect((e as ApprovalError).code).toBe("FORBIDDEN"); } };

  it("lets the Principal change anything, including delegation", () => {
    const next = applyConfigEdit(cfg, edit(cfg, (x) => { x.departments.ECE.hodCanConfigure = true; x.college.routes!.STUDENT["*"] = ["PRINCIPAL"]; }), principal, allowed);
    expect(next.departments.ECE.hodCanConfigure).toBe(true);
    expect(next.college.routes!.STUDENT["*"]).toEqual(["PRINCIPAL"]);
  });
  it("lets a delegated HOD edit only their own department's override", () => {
    const next = applyConfigEdit(cfg, edit(cfg, (x) => { x.departments.CSE.override!.routes!.STUDENT["*"] = ["HOD"]; }), hodCse, allowed);
    expect(next.departments.CSE.override!.routes!.STUDENT["*"]).toEqual(["HOD"]);
    expect(next.college).toEqual(cfg.college);
  });
  it("refuses an HOD who wasn't delegated, or who touches another department, college rules, enabled or the delegation flag", () => {
    expectForbidden(() => applyConfigEdit(cfg, edit(cfg, (x) => { x.departments.ECE.override = { limits: { maxDays: 1 } }; }), { role: "HOD", departments: ["ECE"] }, allowed));
    expectForbidden(() => applyConfigEdit(cfg, edit(cfg, (x) => { x.departments.ECE.override = { limits: { maxDays: 1 } }; }), hodCse, allowed));
    expectForbidden(() => applyConfigEdit(cfg, edit(cfg, (x) => { x.college.limits = { maxDays: 99 }; }), hodCse, allowed));
    expectForbidden(() => applyConfigEdit(cfg, edit(cfg, (x) => { x.enabled = false; }), hodCse, allowed));
    expectForbidden(() => applyConfigEdit(cfg, edit(cfg, (x) => { x.departments.CSE.hodCanConfigure = false; }), hodCse, allowed));
  });
  it("accepts an unchanged config from an HOD (a plain save with nothing altered)", () => {
    expect(applyConfigEdit(cfg, structuredClone(cfg), hodCse, allowed)).toEqual(cfg);
  });
  it("emptyConfig is enabled with no rules", () => {
    expect(emptyConfig()).toEqual({ enabled: true, college: {}, departments: {} });
  });
});
