import type { Firestore } from "firebase-admin/firestore";
import type { LeaveTypeCode, LeaveTypeFull, LeaveTypeRuleOverride } from "@/types/leave";
import type { FacultyNorms } from "@/types/core";
import { LEAVE_TYPE_SEED } from "./seedData";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";

type Overrides = FacultyNorms["leaveTypeRuleOverrides"];

// Merges the college's own Settings > Leave Policy overrides on top of the
// built-in seed - a field left unset in the override keeps the seed's value,
// so a college that never touches this setting behaves exactly as before.
// Structural fields (isActive, eligibleCategories, unlimited, label, color,
// sortOrder) are deliberately NOT overridable - see the "customize rules
// only" scope decision - only rules.* fields ever change per college.
export function resolveLeaveTypes(overrides: Overrides): LeaveTypeFull[] {
  if (!overrides) return LEAVE_TYPE_SEED;
  return LEAVE_TYPE_SEED.map((lt) => {
    const o = overrides[lt.code];
    return o ? { ...lt, rules: { ...lt.rules, ...o } } : lt;
  });
}

export function resolveLeaveType(overrides: Overrides, code: LeaveTypeCode): LeaveTypeFull | undefined {
  const base = LEAVE_TYPE_SEED.find((lt) => lt.code === code);
  if (!base) return undefined;
  const o = overrides?.[code];
  return o ? { ...base, rules: { ...base.rules, ...o } } : base;
}

export async function loadResolvedLeaveTypes(db: Firestore, collegeId: string): Promise<LeaveTypeFull[]> {
  const settings = await loadCollegeSettings(db, collegeId);
  return resolveLeaveTypes(settings.leaveTypeRuleOverrides);
}

export function sanitizeLeaveTypeRuleOverride(input: unknown): { ok: true; rule: LeaveTypeRuleOverride } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Each leave type override must be an object" };
  const r = input as Record<string, unknown>;
  const rule: LeaveTypeRuleOverride = {};

  const num = (key: string, min: number, max: number): number | undefined => {
    if (r[key] === undefined || r[key] === null) return undefined;
    const n = Number(r[key]);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${key} must be a number between ${min} and ${max}`);
    return n;
  };

  try {
    const daysPerYear = num("daysPerYear", 0, 365);
    if (daysPerYear !== undefined) rule.daysPerYear = daysPerYear;

    if (r.entitlementByCategory !== undefined) {
      if (typeof r.entitlementByCategory !== "object" || r.entitlementByCategory === null) {
        return { ok: false, error: "entitlementByCategory must be an object" };
      }
      const ebc: Record<string, number> = {};
      for (const [cat, val] of Object.entries(r.entitlementByCategory as Record<string, unknown>)) {
        if (!["new-joining", "vacation", "non-vacation"].includes(cat)) return { ok: false, error: `Unknown category ${cat}` };
        const n = Number(val);
        if (!Number.isFinite(n) || n < 0 || n > 365) return { ok: false, error: `entitlementByCategory.${cat} must be a number between 0 and 365` };
        ebc[cat] = n;
      }
      rule.entitlementByCategory = ebc as LeaveTypeRuleOverride["entitlementByCategory"];
    }

    if (r.carryForward !== undefined) {
      if (typeof r.carryForward !== "object" || r.carryForward === null) return { ok: false, error: "carryForward must be an object" };
      const cf = r.carryForward as Record<string, unknown>;
      if (typeof cf.enabled !== "boolean") return { ok: false, error: "carryForward.enabled must be a boolean" };
      const cap = cf.cap === undefined || cf.cap === null ? undefined : Number(cf.cap);
      if (cap !== undefined && (!Number.isFinite(cap) || cap < 0)) return { ok: false, error: "carryForward.cap must be a non-negative number" };
      rule.carryForward = { enabled: cf.enabled, ...(cap !== undefined ? { cap } : {}) };
    }

    if (r.halfDayAllowed !== undefined) {
      if (typeof r.halfDayAllowed !== "boolean") return { ok: false, error: "halfDayAllowed must be a boolean" };
      rule.halfDayAllowed = r.halfDayAllowed;
    }

    if (r.reasonOptions !== undefined) {
      if (!Array.isArray(r.reasonOptions) || r.reasonOptions.some((x) => typeof x !== "string" || !x.trim())) {
        return { ok: false, error: "reasonOptions must be an array of non-empty strings" };
      }
      rule.reasonOptions = (r.reasonOptions as string[]).map((s) => s.trim());
    }
    if (r.allowCustomReason !== undefined) {
      if (typeof r.allowCustomReason !== "boolean") return { ok: false, error: "allowCustomReason must be a boolean" };
      rule.allowCustomReason = r.allowCustomReason;
    }

    const maxConsecutiveDays = num("maxConsecutiveDays", 1, 3650);
    if (maxConsecutiveDays !== undefined) rule.maxConsecutiveDays = maxConsecutiveDays;
    const minAdvanceNoticeDays = num("minAdvanceNoticeDays", 0, 365);
    if (minAdvanceNoticeDays !== undefined) rule.minAdvanceNoticeDays = minAdvanceNoticeDays;
    const maxRequestsPerMonth = num("maxRequestsPerMonth", 1, 100);
    if (maxRequestsPerMonth !== undefined) rule.maxRequestsPerMonth = maxRequestsPerMonth;
    const escalateAfterDays = num("escalateAfterDays", 1, 3650);
    if (escalateAfterDays !== undefined) rule.escalateAfterDays = escalateAfterDays;
    const maxLopDaysBeforeEscalation = num("maxLopDaysBeforeEscalation", 0, 3650);
    if (maxLopDaysBeforeEscalation !== undefined) rule.maxLopDaysBeforeEscalation = maxLopDaysBeforeEscalation;

    if (r.eligibleGenders !== undefined) {
      if (!Array.isArray(r.eligibleGenders) || r.eligibleGenders.some((g) => !["Male", "Female", "Other"].includes(g as string))) {
        return { ok: false, error: "eligibleGenders must be an array of Male/Female/Other" };
      }
      rule.eligibleGenders = r.eligibleGenders as LeaveTypeRuleOverride["eligibleGenders"];
    }
    if (r.sandwichRule !== undefined) {
      if (typeof r.sandwichRule !== "boolean") return { ok: false, error: "sandwichRule must be a boolean" };
      rule.sandwichRule = r.sandwichRule;
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid leave type override" };
  }

  return { ok: true, rule };
}

export function sanitizeLeaveTypeRuleOverrides(
  input: unknown
): { ok: true; overrides: Partial<Record<LeaveTypeCode, LeaveTypeRuleOverride>> } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "leaveTypeRuleOverrides must be an object" };
  const validCodes = new Set(LEAVE_TYPE_SEED.map((lt) => lt.code));
  const overrides: Partial<Record<LeaveTypeCode, LeaveTypeRuleOverride>> = {};
  for (const [code, rule] of Object.entries(input as Record<string, unknown>)) {
    if (!validCodes.has(code as LeaveTypeCode)) return { ok: false, error: `Unknown leave type ${code}` };
    const checked = sanitizeLeaveTypeRuleOverride(rule);
    if (!checked.ok) return { ok: false, error: `${code}: ${checked.error}` };
    overrides[code as LeaveTypeCode] = checked.rule;
  }
  return { ok: true, overrides };
}

export function sanitizeLeaveBlackoutWindows(
  input: unknown
): { ok: true; windows: NonNullable<FacultyNorms["leaveBlackoutWindows"]> } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "leaveBlackoutWindows must be an array" };
  const validCodes = new Set(LEAVE_TYPE_SEED.map((lt) => lt.code));
  const windows: NonNullable<FacultyNorms["leaveBlackoutWindows"]> = [];
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  for (let i = 0; i < input.length; i++) {
    const w = input[i] as Record<string, unknown>;
    const id = typeof w.id === "string" && w.id ? w.id : `bw_${Date.now()}_${i}`;
    if (typeof w.fromDate !== "string" || !dateRe.test(w.fromDate)) return { ok: false, error: `windows[${i}].fromDate must be YYYY-MM-DD` };
    if (typeof w.toDate !== "string" || !dateRe.test(w.toDate)) return { ok: false, error: `windows[${i}].toDate must be YYYY-MM-DD` };
    if (w.toDate < w.fromDate) return { ok: false, error: `windows[${i}]: toDate can't be before fromDate` };
    if (typeof w.reason !== "string" || !w.reason.trim()) return { ok: false, error: `windows[${i}].reason is required` };
    let appliesToTypes: LeaveTypeCode[] | undefined;
    if (w.appliesToTypes !== undefined) {
      if (!Array.isArray(w.appliesToTypes) || w.appliesToTypes.some((c) => !validCodes.has(c as LeaveTypeCode))) {
        return { ok: false, error: `windows[${i}].appliesToTypes must be an array of valid leave type codes` };
      }
      appliesToTypes = w.appliesToTypes as LeaveTypeCode[];
    }
    windows.push({ id, fromDate: w.fromDate, toDate: w.toDate, reason: w.reason.trim(), ...(appliesToTypes ? { appliesToTypes } : {}) });
  }
  return { ok: true, windows };
}
