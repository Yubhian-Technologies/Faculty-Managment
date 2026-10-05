import { ApprovalError } from "./types";
import type { StageId } from "./types";
import { assertChain } from "./stateMachine";

// Layered, per-kind configuration: college defaults, optionally overridden per
// department - and a department's override is only editable by its HOD when the
// Principal has delegated that (hodCanConfigure). Routes are keyed by requester
// type and then by the kind's own "type of request" key (a category, or a whole
// group of categories), with "*" as the catch-all.

export interface RuleSet<L extends object = Record<string, unknown>> {
  /** requesterType -> request-type key | "*" -> ordered stages. */
  routes?: Record<string, Record<string, StageId[]>>;
  limits?: Partial<L>;
  /** Request-type keys switched off for this scope. */
  disabledTypes?: string[];
}

export interface DepartmentConfig<L extends object = Record<string, unknown>> {
  /** Principal-controlled: may this department's HOD edit `override`? */
  hodCanConfigure: boolean;
  override?: RuleSet<L>;
}

export interface KindConfig<L extends object = Record<string, unknown>> {
  enabled: boolean;
  college: RuleSet<L>;
  departments: Record<string, DepartmentConfig<L>>;
  updatedAt?: string;
  updatedByName?: string;
}

export const emptyConfig = <L extends object>(): KindConfig<L> => ({ enabled: true, college: {}, departments: {} });

/**
 * The route for a request: the most specific configured chain wins.
 * Order: department override, then college - and within each, the request-type
 * keys from most to least specific (e.g. ["nptel", "certifications"]) and
 * finally "*". Falls back to the kind's built-in default.
 */
export function resolveRoute<L extends object>(
  config: KindConfig<L> | undefined,
  fallback: (requesterType: string) => StageId[],
  q: { department: string; requesterType: string; typeKeys: readonly string[] }
): StageId[] {
  const layers: (RuleSet<L> | undefined)[] = [config?.departments?.[q.department]?.override, config?.college];
  for (const layer of layers) {
    const byType = layer?.routes?.[q.requesterType];
    if (!byType) continue;
    for (const key of [...q.typeKeys, "*"]) {
      const chain = byType[key];
      if (chain && chain.length > 0) return [...chain];
    }
  }
  return fallback(q.requesterType);
}

/** Built-in limits <- college limits <- department limits (later wins, per field). */
export function resolveLimits<L extends object>(config: KindConfig<L> | undefined, defaults: L, department: string): L {
  return { ...defaults, ...(config?.college?.limits ?? {}), ...(config?.departments?.[department]?.override?.limits ?? {}) };
}

/** Whether a request type is switched off for a department (college or department level). */
export function isTypeDisabled<L extends object>(config: KindConfig<L> | undefined, department: string, typeKeys: readonly string[]): boolean {
  const off = new Set([...(config?.college?.disabledTypes ?? []), ...(config?.departments?.[department]?.override?.disabledTypes ?? [])]);
  return typeKeys.some((k) => off.has(k));
}

export type ConfigEditor =
  | { role: "PRINCIPAL" }
  | { role: "HOD"; departments: readonly string[] };

/** Cleans a rule set: only known stages, valid chains, no empty routes. Throws on a bad chain. */
export function sanitizeRuleSet<L extends object>(
  rs: RuleSet<L> | undefined,
  allowedStages: (requesterType: string) => readonly StageId[]
): RuleSet<L> {
  if (!rs) return {};
  const out: RuleSet<L> = {};
  if (rs.routes) {
    out.routes = {};
    for (const [type, byKey] of Object.entries(rs.routes)) {
      const allowed = new Set(allowedStages(type));
      const clean: Record<string, StageId[]> = {};
      for (const [key, chain] of Object.entries(byKey ?? {})) {
        if (!chain || chain.length === 0) continue; // an empty route means "use the next layer"
        const stages = assertChain(chain);
        const bad = stages.find((s) => !allowed.has(s));
        if (bad) throw new ApprovalError("INVALID", `"${bad}" isn't a valid stage for ${type} requests`);
        clean[key] = stages;
      }
      if (Object.keys(clean).length) out.routes[type] = clean;
    }
  }
  if (rs.limits) out.limits = rs.limits;
  if (rs.disabledTypes) out.disabledTypes = Array.from(new Set(rs.disabledTypes));
  return out;
}

/**
 * Applies a proposed config to the stored one, enforcing who may change what:
 *  - PRINCIPAL: everything (enabled, college rules, every department's override, and the delegation flags).
 *  - HOD: only the override of a department they head, and only while the
 *    Principal has set hodCanConfigure for it. Cannot touch the college rules,
 *    other departments, `enabled`, or the delegation flag itself.
 * Anything else throws FORBIDDEN rather than being silently dropped, so a
 * rejected edit is never mistaken for a saved one.
 */
export function applyConfigEdit<L extends object>(
  current: KindConfig<L>,
  proposed: KindConfig<L>,
  editor: ConfigEditor,
  allowedStages: (requesterType: string) => readonly StageId[]
): KindConfig<L> {
  if (editor.role === "PRINCIPAL") {
    const departments: KindConfig<L>["departments"] = {};
    for (const [dept, dc] of Object.entries(proposed.departments ?? {})) {
      departments[dept] = { hodCanConfigure: !!dc.hodCanConfigure, override: sanitizeRuleSet(dc.override, allowedStages) };
    }
    return { enabled: proposed.enabled !== false, college: sanitizeRuleSet(proposed.college, allowedStages), departments };
  }

  const mine = new Set(editor.departments);
  const next: KindConfig<L> = { ...current, departments: { ...current.departments } };
  if (proposed.enabled !== current.enabled || JSON.stringify(proposed.college ?? {}) !== JSON.stringify(current.college ?? {})) {
    throw new ApprovalError("FORBIDDEN", "Only the Principal can change college-wide settings", 403);
  }
  for (const dept of new Set([...Object.keys(current.departments), ...Object.keys(proposed.departments ?? {})])) {
    const before = current.departments[dept];
    const after = proposed.departments?.[dept];
    const unchanged = JSON.stringify(before ?? null) === JSON.stringify(after ?? null);
    if (unchanged) continue;
    if (!mine.has(dept)) throw new ApprovalError("FORBIDDEN", `You can only configure your own department (not ${dept})`, 403);
    if (!before?.hodCanConfigure) throw new ApprovalError("FORBIDDEN", `The Principal hasn't allowed HODs to configure ${dept}`, 403);
    if (!!after?.hodCanConfigure !== !!before.hodCanConfigure) throw new ApprovalError("FORBIDDEN", "Only the Principal can grant or withdraw this access", 403);
    next.departments[dept] = { hodCanConfigure: true, override: sanitizeRuleSet(after?.override, allowedStages) };
  }
  return next;
}
