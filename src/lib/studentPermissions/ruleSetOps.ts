import type { RuleSet } from "@/lib/approvals/config";
import type { PermissionLimits } from "./types";

// Small immutable edits to a RuleSet, used by the configuration screen. They
// keep the stored shape tidy (no empty routes, no empty objects) so what is
// saved is exactly what the resolvers read.

export type PermissionRuleSet = RuleSet<PermissionLimits>;

/** Sets (or, with an empty chain, clears) the route for one requester type and request-type key ("*" = all). */
export function setRoute(rs: PermissionRuleSet | undefined, requesterType: string, key: string, chain: string[]): PermissionRuleSet {
  const routes = { ...(rs?.routes ?? {}) };
  const byKey = { ...(routes[requesterType] ?? {}) };
  if (chain.length === 0) delete byKey[key]; else byKey[key] = chain;
  if (Object.keys(byKey).length === 0) delete routes[requesterType]; else routes[requesterType] = byKey;
  const next: PermissionRuleSet = { ...rs, routes };
  if (Object.keys(routes).length === 0) delete next.routes;
  return next;
}

export const getRoute = (rs: PermissionRuleSet | undefined, requesterType: string, key: string): string[] => rs?.routes?.[requesterType]?.[key] ?? [];

/** Sets one limit; `undefined` removes it so the value is inherited again. */
export function setLimit<K extends keyof PermissionLimits>(rs: PermissionRuleSet | undefined, key: K, value: PermissionLimits[K] | undefined): PermissionRuleSet {
  const limits: Partial<PermissionLimits> = { ...(rs?.limits ?? {}) };
  if (value === undefined) delete limits[key]; else limits[key] = value;
  const next: PermissionRuleSet = { ...rs, limits };
  if (Object.keys(limits).length === 0) delete next.limits;
  return next;
}

/** Sets how many hours one approver level may take before the request moves up; `undefined` (or < 1) removes the limit. */
export function setStageHours(rs: PermissionRuleSet | undefined, stage: string, hours: number | undefined): PermissionRuleSet {
  const byStage = { ...(rs?.limits?.stageHours ?? {}) };
  if (hours === undefined || !Number.isFinite(hours) || hours < 1) delete byStage[stage]; else byStage[stage] = Math.min(720, Math.round(hours));
  return setLimit(rs, "stageHours", Object.keys(byStage).length ? byStage : undefined);
}

/** Sets proof required / optional for one permission type (group or item); `undefined` inherits again. */
export function setProofForType(rs: PermissionRuleSet | undefined, key: string, required: boolean | undefined): PermissionRuleSet {
  const byType = { ...(rs?.limits?.proofByType ?? {}) };
  if (required === undefined) delete byType[key]; else byType[key] = required;
  return setLimit(rs, "proofByType", Object.keys(byType).length ? byType : undefined);
}

/** Limits who may raise one permission type; an empty list (or undefined) means anyone. */
export function setRequestersForType(rs: PermissionRuleSet | undefined, key: string, roles: string[] | undefined): PermissionRuleSet {
  const byType = { ...(rs?.limits?.requestersByType ?? {}) };
  if (!roles?.length) delete byType[key]; else byType[key] = roles;
  return setLimit(rs, "requestersByType", Object.keys(byType).length ? byType : undefined);
}

/** Switches a request type (a group or one item) off or back on. */
export function setTypeDisabled(rs: PermissionRuleSet | undefined, key: string, disabled: boolean): PermissionRuleSet {
  const set = new Set(rs?.disabledTypes ?? []);
  if (disabled) set.add(key); else set.delete(key);
  const next: PermissionRuleSet = { ...rs, disabledTypes: Array.from(set) };
  if (set.size === 0) delete next.disabledTypes;
  return next;
}

export const isDisabled = (rs: PermissionRuleSet | undefined, key: string) => !!rs?.disabledTypes?.includes(key);

/** Chain editing helpers (pure, so the UI stays declarative). */
export const addStage = (chain: readonly string[], stage: string) => (chain.includes(stage) ? [...chain] : [...chain, stage]);
export const removeStage = (chain: readonly string[], stage: string) => chain.filter((s) => s !== stage);
export function moveStage(chain: readonly string[], index: number, delta: -1 | 1): string[] {
  const to = index + delta;
  if (index < 0 || index >= chain.length || to < 0 || to >= chain.length) return [...chain];
  const out = [...chain];
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}
