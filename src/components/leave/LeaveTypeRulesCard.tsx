"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lock, X } from "lucide-react";
import { toast } from "@/hooks/useToast";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import type {
  EffectiveLeaveCategory, LeaveTypeCode, LeaveTypeRuleOverride, LeaveBlackoutWindow, LeaveProofRouteTarget,
  GroupLeavePolicy, LeaveRuleField,
} from "@/types/leave";
import { EFFECTIVE_CATEGORY_LABELS } from "@/types/leave";
import type { FacultyNorms } from "@/types/core";
import { dmy } from "@/lib/utils";

type Overrides = Partial<Record<LeaveTypeCode, LeaveTypeRuleOverride>>;

const GENDERS: ("Male" | "Female" | "Other")[] = ["Male", "Female", "Other"];

function pickKeys(rule: LeaveTypeRuleOverride | undefined, keys: (keyof LeaveTypeRuleOverride)[]): LeaveTypeRuleOverride {
  const out: LeaveTypeRuleOverride = {};
  for (const k of keys) if (rule?.[k] !== undefined) (out as Record<string, unknown>)[k] = rule[k];
  return out;
}

/** The Super Admin's value of a rule, in words (shown to a college as "Group default: ..."), or null when unset. */
function groupValueText(rule: LeaveTypeRuleOverride | undefined, field: LeaveRuleField): string | null {
  if (!rule) return null;
  switch (field) {
    case "entitlementByCategory": {
      const e = rule.entitlementByCategory;
      return e && Object.keys(e).length ? Object.entries(e).map(([k, v]) => `${EFFECTIVE_CATEGORY_LABELS[k as EffectiveLeaveCategory]} ${v}`).join(", ") : null;
    }
    case "carryForward": return rule.carryForward ? (rule.carryForward.enabled ? `on${rule.carryForward.cap != null ? `, cap ${rule.carryForward.cap}` : ""}` : "off") : null;
    case "halfDayAllowed": return rule.halfDayAllowed === undefined ? null : rule.halfDayAllowed ? "half day allowed" : "full day only";
    case "eligibleGenders": return rule.eligibleGenders?.length ? rule.eligibleGenders.join(", ") : null;
    case "reasons": return rule.reasonOptions?.length ? rule.reasonOptions.map((r) => r.label).join(", ") : null;
    default: { const v = rule[field as keyof LeaveTypeRuleOverride]; return v === undefined || v === null ? null : String(v); }
  }
}

// Settings > "Leave Policy" - per-college customization of the 6 built-in
// leave types' rules (limits, carry-forward, half-day, reason dropdown,
// consecutive-day/notice/frequency caps, gender/escalation rules) plus
// college-wide blackout windows - see resolveLeaveTypes.ts. Saved on its own
// (not the page's main Save button), same convention as
// LeaveApprovalRoutingCard. A field left blank/unchecked for a type simply
// isn't sent as part of that type's override, so it falls back to the
// built-in seed default (src/lib/leave/seedData.ts) - a college that never
// opens this card sees no behavior change at all.
//
// mode "group" (Super Admin > Settings > Leave Policy): the same editor for the Super Admin's rules for EVERY college
// (systemSettings/leavePolicy), with a "Lock for all colleges" tick per rule. In the college mode a locked rule shows
// the Super Admin's value read-only, and an unlocked group value shows as "Group default: ...".
export function LeaveTypeRulesCard({ mode = "college" }: { mode?: "college" | "group" } = {}) {
  const isGroup = mode === "group";
  const [overrides, setOverrides] = useState<Overrides>({});
  // Group mode: what the Super Admin locks. College mode: what the Super Admin locked (read only) and their values.
  const [locks, setLocks] = useState<GroupLeavePolicy["locked"]>({});
  const [groupRules, setGroupRules] = useState<GroupLeavePolicy["rules"]>({});
  const [windows, setWindows] = useState<LeaveBlackoutWindow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [reasonDraft, setReasonDraft] = useState<Partial<Record<LeaveTypeCode, string>>>({});
  const [reasonProofDraft, setReasonProofDraft] = useState<Partial<Record<LeaveTypeCode, LeaveProofRouteTarget>>>({});
  const [newWindow, setNewWindow] = useState({ fromDate: "", toDate: "", reason: "" });

  useEffect(() => {
    (isGroup
      ? fetch("/api/admin/settings/leave-policy")
        .then((r) => r.json() as Promise<{ policy?: GroupLeavePolicy }>)
        .then(({ policy }) => {
          setOverrides(policy?.rules ?? {});
          setLocks(policy?.locked ?? {});
        })
      : fetch("/api/college/settings/general")
        .then((r) => r.json() as Promise<{ settings: FacultyNorms; groupLeavePolicy?: GroupLeavePolicy | null }>)
        .then(({ settings, groupLeavePolicy }) => {
          setOverrides(settings.leaveTypeRuleOverrides ?? {});
          setWindows(settings.leaveBlackoutWindows ?? []);
          setLocks(groupLeavePolicy?.locked ?? {});
          setGroupRules(groupLeavePolicy?.rules ?? {});
        }))
      .catch(() => toast({ variant: "destructive", title: "Unable to load leave policy." }))
      .finally(() => setIsLoading(false));
  }, [isGroup]);

  const lockedHere = (code: LeaveTypeCode, field: LeaveRuleField) => !!locks[code]?.includes(field);
  const lockedKeys = (code: LeaveTypeCode) => (locks[code] ?? []).flatMap((f) => (f === "reasons" ? ["reasonOptions", "allowCustomReason"] : [f])) as (keyof LeaveTypeRuleOverride)[];

  /** One rule's block: in group mode with its lock tick; in college mode read-only when locked, else the group default noted. */
  function ruleField(code: LeaveTypeCode, field: LeaveRuleField, node: ReactNode) {
    if (isGroup) {
      return (
        <div className="space-y-1.5 rounded-md border border-dashed p-2">
          <label className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={lockedHere(code, field)}
              onCheckedChange={(c) => setLocks((prev) => {
                const cur = new Set(prev[code] ?? []);
                if (c) cur.add(field); else cur.delete(field);
                return { ...prev, [code]: [...cur] };
              })}
            />
            <Lock className="h-3 w-3" />Lock for all colleges
          </label>
          {node}
        </div>
      );
    }
    const locked = lockedHere(code, field);
    const note = groupValueText(groupRules[code], field);
    return (
      <fieldset disabled={locked} className={locked ? "space-y-1 rounded-md bg-muted/40 p-2 opacity-80" : "space-y-1"}>
        {locked
          ? <p className="flex items-center gap-1 text-xs font-medium text-violet-700"><Lock className="h-3 w-3" />Set by Super Admin for all colleges</p>
          : note && <p className="text-xs text-muted-foreground">Group default: {note} (blank keeps it)</p>}
        {node}
      </fieldset>
    );
  }

  function patch(code: LeaveTypeCode, fields: LeaveTypeRuleOverride) {
    setOverrides((prev) => {
      const next = { ...(prev[code] ?? {}), ...fields };
      // Drop keys explicitly unset (undefined) so an unchecked/cleared field
      // actually falls back to the seed default instead of saving `undefined`.
      for (const k of Object.keys(next) as (keyof LeaveTypeRuleOverride)[]) {
        if (next[k] === undefined) delete next[k];
      }
      return { ...prev, [code]: next };
    });
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      // College: rules the Super Admin locked are never sent (they can't be changed here).
      const own = Object.fromEntries(Object.entries(overrides).map(([code, o]) => {
        const copy = { ...(o ?? {}) };
        if (!isGroup) for (const k of lockedKeys(code as LeaveTypeCode)) delete copy[k];
        return [code, copy];
      }));
      const res = isGroup
        ? await fetch("/api/admin/settings/leave-policy", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rules: own, locked: locks }),
        })
        : await fetch("/api/college/settings/general", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leaveTypeRuleOverrides: own, leaveBlackoutWindows: windows }),
        });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? "Unable to save");
      }
      toast({ variant: "success", title: isGroup ? "Leave policy saved for all colleges." : "Leave policy saved." });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save" });
    } finally {
      setIsSaving(false);
    }
  }

  function addWindow() {
    if (!newWindow.fromDate || !newWindow.toDate || !newWindow.reason.trim()) {
      toast({ variant: "destructive", title: "From date, to date and reason are all required" });
      return;
    }
    if (newWindow.toDate < newWindow.fromDate) {
      toast({ variant: "destructive", title: "To date can't be before from date" });
      return;
    }
    setWindows((prev) => [...prev, { id: `bw_${Date.now()}`, ...newWindow, reason: newWindow.reason.trim() }]);
    setNewWindow({ fromDate: "", toDate: "", reason: "" });
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6"><div className="h-40 bg-muted animate-pulse rounded-lg" /></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{isGroup ? "Leave Policy (All Colleges)" : "Leave Policy"}</CardTitle>
        <CardDescription>
          {isGroup
            ? "Rules for every college. A rule left blank keeps the built-in default; a rule set here is the group default a college may change, unless you tick \"Lock for all colleges\" - then every college uses it and can't change it. New days per year apply to balances created from now on (new staff, the next leave year); this year's balances keep their days."
            : "Customise the limits, carry-forward, half-day and reason rules of each leave type for your college. Fields left blank keep the default. Rules the Super Admin locked can't be changed here."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Accordion type="multiple" className="rounded-lg border">
          {LEAVE_TYPE_SEED.map((lt) => {
            // College: a locked rule shows the Super Admin's value (its own saved value, if any, never applies).
            const own = overrides[lt.code] ?? {};
            const o: LeaveTypeRuleOverride = isGroup ? own : { ...own, ...pickKeys(groupRules[lt.code], lockedKeys(lt.code)) };
            return (
              <AccordionItem key={lt.code} value={lt.code} className="px-3">
                <AccordionTrigger>
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{lt.label}</span>
                    <span className="text-xs text-muted-foreground">({lt.shortLabel})</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pb-4">
{ruleField(lt.code, "entitlementByCategory", (<>
                  {!lt.rules.unlimited && (
                    <div className="space-y-2">
                      <Label className="text-xs">Days per year, by category</Label>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {lt.rules.eligibleCategories.map((cat) => (
                          <div key={cat} className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{EFFECTIVE_CATEGORY_LABELS[cat]}</Label>
                            <Input
                              type="number" min={0} max={365} className="w-full"
                              value={o.entitlementByCategory?.[cat] ?? ""}
                              placeholder="Default"
                              onChange={(e) => {
                                const v = e.target.value === "" ? undefined : Number(e.target.value);
                                const ebc = { ...(o.entitlementByCategory ?? {}) };
                                if (v === undefined) delete ebc[cat as EffectiveLeaveCategory];
                                else ebc[cat as EffectiveLeaveCategory] = v;
                                patch(lt.code, { entitlementByCategory: Object.keys(ebc).length ? ebc : undefined });
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

</>))}
{ruleField(lt.code, "carryForward", (<>
                  {!lt.rules.unlimited && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`${lt.code}-cf`}
                          checked={!!o.carryForward?.enabled}
                          // Always an explicit {enabled: false/true}, never
                          // cleared to undefined - EL's seed default is
                          // enabled:true (see seedData.ts), so unchecking
                          // this must override that explicitly rather than
                          // just deleting the key, which would fall straight
                          // back to that same enabled:true default.
                          onCheckedChange={(c) => patch(lt.code, { carryForward: { enabled: !!c, ...(c ? { cap: o.carryForward?.cap } : {}) } })}
                        />
                        <Label htmlFor={`${lt.code}-cf`} className="text-sm font-normal">Unused days carry forward to next year</Label>
                      </div>
                      {o.carryForward?.enabled && (
                        <div className="pl-6 space-y-1 max-w-xs">
                          <Label className="text-xs text-muted-foreground">Cap on total balance (blank = uncapped)</Label>
                          <Input
                            type="number" min={0}
                            value={o.carryForward?.cap ?? ""}
                            onChange={(e) => patch(lt.code, {
                              carryForward: { enabled: true, cap: e.target.value === "" ? undefined : Number(e.target.value) },
                            })}
                          />
                        </div>
                      )}
                    </div>
                  )}

</>))}
{ruleField(lt.code, "halfDayAllowed", (<>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`${lt.code}-half`}
                      checked={!!o.halfDayAllowed}
                      onCheckedChange={(c) => patch(lt.code, { halfDayAllowed: !!c })}
                    />
                    <Label htmlFor={`${lt.code}-half`} className="text-sm font-normal">Half day allowed</Label>
                  </div>

</>))}
                  <div className="grid gap-3 sm:grid-cols-3">
{ruleField(lt.code, "maxConsecutiveDays", (<>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Max consecutive days</Label>
                      <Input
                        type="number" min={1}
                        value={o.maxConsecutiveDays ?? ""}
                        onChange={(e) => patch(lt.code, { maxConsecutiveDays: e.target.value === "" ? undefined : Number(e.target.value) })}
                      />
                    </div>
</>))}
{ruleField(lt.code, "minAdvanceNoticeDays", (<>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Min advance notice (days)</Label>
                      <Input
                        type="number" min={0}
                        value={o.minAdvanceNoticeDays ?? ""}
                        onChange={(e) => patch(lt.code, { minAdvanceNoticeDays: e.target.value === "" ? undefined : Number(e.target.value) })}
                      />
                    </div>
</>))}
{ruleField(lt.code, "maxRequestsPerMonth", (<>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Max requests / month</Label>
                      <Input
                        type="number" min={1}
                        value={o.maxRequestsPerMonth ?? ""}
                        onChange={(e) => patch(lt.code, { maxRequestsPerMonth: e.target.value === "" ? undefined : Number(e.target.value) })}
                      />
                    </div>
</>))}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Escalate to Principal (skip HOD) when...</Label>
                    <div className="grid gap-3 sm:grid-cols-2">
{ruleField(lt.code, "escalateAfterDays", (<>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Longer than (days)</Label>
                        <Input
                          type="number" min={1}
                          value={o.escalateAfterDays ?? ""}
                          onChange={(e) => patch(lt.code, { escalateAfterDays: e.target.value === "" ? undefined : Number(e.target.value) })}
                        />
                      </div>
</>))}
{ruleField(lt.code, "maxLopDaysBeforeEscalation", (<>
                      {!lt.rules.unlimited && (
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Projected Loss-of-Pay exceeds (days)</Label>
                          <Input
                            type="number" min={0}
                            value={o.maxLopDaysBeforeEscalation ?? ""}
                            onChange={(e) => patch(lt.code, { maxLopDaysBeforeEscalation: e.target.value === "" ? undefined : Number(e.target.value) })}
                          />
                        </div>
                      )}
</>))}
                    </div>
                  </div>

{ruleField(lt.code, "eligibleGenders", (<>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Eligible gender (blank = everyone)</Label>
                    <div className="flex gap-4">
                      {GENDERS.map((g) => (
                        <div key={g} className="flex items-center gap-1.5">
                          <Checkbox
                            id={`${lt.code}-gender-${g}`}
                            checked={!!o.eligibleGenders?.includes(g)}
                            onCheckedChange={(c) => {
                              const current = o.eligibleGenders ?? [];
                              const next = c ? [...current, g] : current.filter((x) => x !== g);
                              patch(lt.code, { eligibleGenders: next.length ? next : undefined });
                            }}
                          />
                          <Label htmlFor={`${lt.code}-gender-${g}`} className="text-sm font-normal">{g}</Label>
                        </div>
                      ))}
                    </div>
                  </div>

{ruleField(lt.code, "reasons", (<>
</>))}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Reason dropdown</Label>
                    {/* Proof to: which department follows up on a supporting
                        document for this reason - Exam Cell for an exam-duty
                        reason, HOD otherwise (the default when nothing's
                        picked). See LeaveReasonOption in types/leave.ts. */}
                    <div className="space-y-1.5">
                      {(o.reasonOptions ?? []).map((r, i) => (
                        <div key={`${r.label}-${i}`} className="flex items-center gap-2">
                          <span className="flex-1 text-sm rounded-md border px-2.5 py-1.5 bg-muted/40">{r.label}</span>
                          <Select
                            value={r.proofRoutedTo ?? "HOD"}
                            onValueChange={(v) => {
                              const next = [...(o.reasonOptions ?? [])];
                              next[i] = { ...r, ...(v === "EXAM_CELL" ? { proofRoutedTo: "EXAM_CELL" as const } : {}) };
                              if (v !== "EXAM_CELL") delete next[i].proofRoutedTo;
                              patch(lt.code, { reasonOptions: next });
                            }}
                          >
                            <SelectTrigger className="w-36 shrink-0"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="HOD">Proof to HOD</SelectItem>
                              <SelectItem value="EXAM_CELL">Proof to Exam Cell</SelectItem>
                            </SelectContent>
                          </Select>
                          <button
                            type="button"
                            aria-label={`Remove ${r.label}`}
                            className="text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => {
                              const next = (o.reasonOptions ?? []).filter((_, idx) => idx !== i);
                              patch(lt.code, { reasonOptions: next.length ? next : undefined });
                            }}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Add a reason option"
                        value={reasonDraft[lt.code] ?? ""}
                        onChange={(e) => setReasonDraft((prev) => ({ ...prev, [lt.code]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          const v = (reasonDraft[lt.code] ?? "").trim();
                          if (!v || o.reasonOptions?.some((x) => x.label === v)) return;
                          const proofRoutedTo = reasonProofDraft[lt.code];
                          patch(lt.code, {
                            reasonOptions: [...(o.reasonOptions ?? []), { label: v, ...(proofRoutedTo === "EXAM_CELL" ? { proofRoutedTo } : {}) }],
                          });
                          setReasonDraft((prev) => ({ ...prev, [lt.code]: "" }));
                        }}
                      />
                      <Select
                        value={reasonProofDraft[lt.code] ?? "HOD"}
                        onValueChange={(v) => setReasonProofDraft((prev) => ({ ...prev, [lt.code]: v as LeaveProofRouteTarget }))}
                      >
                        <SelectTrigger className="w-36 shrink-0"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="HOD">Proof to HOD</SelectItem>
                          <SelectItem value="EXAM_CELL">Proof to Exam Cell</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button" variant="outline"
                        onClick={() => {
                          const v = (reasonDraft[lt.code] ?? "").trim();
                          if (!v || o.reasonOptions?.some((x) => x.label === v)) return;
                          const proofRoutedTo = reasonProofDraft[lt.code];
                          patch(lt.code, {
                            reasonOptions: [...(o.reasonOptions ?? []), { label: v, ...(proofRoutedTo === "EXAM_CELL" ? { proofRoutedTo } : {}) }],
                          });
                          setReasonDraft((prev) => ({ ...prev, [lt.code]: "" }));
                        }}
                      >
                        Add
                      </Button>
                    </div>
                    {!!o.reasonOptions?.length && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`${lt.code}-custom-reason`}
                          checked={!!o.allowCustomReason}
                          onCheckedChange={(c) => patch(lt.code, { allowCustomReason: !!c })}
                        />
                        <Label htmlFor={`${lt.code}-custom-reason`} className="text-sm font-normal">
                          Also offer &ldquo;Other&rdquo; with free text
                        </Label>
                      </div>
                    )}
                  </div>
</>))}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        {!isGroup && <div className="space-y-2 border-t pt-4">
          <Label className="text-sm font-medium">Blackout windows</Label>
          <p className="text-xs text-muted-foreground">Date ranges during which leave cannot be applied (for example, examination week). Leave Applies To unset to block every leave type, including Other requests.</p>
          {windows.length > 0 && (
            <div className="divide-y rounded-lg border">
              {windows.map((w) => (
                <div key={w.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{dmy(w.fromDate)} → {dmy(w.toDate)}</span>
                    <span className="text-muted-foreground"> · {w.reason}</span>
                    {w.appliesToTypes && (
                      <span className="text-muted-foreground"> · {w.appliesToTypes.join(", ")} only</span>
                    )}
                  </span>
                  <Button variant="ghost" size="icon" onClick={() => setWindows((prev) => prev.filter((x) => x.id !== w.id))}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-4">
            <Input type="date" value={newWindow.fromDate} onChange={(e) => setNewWindow((p) => ({ ...p, fromDate: e.target.value }))} />
            <Input type="date" value={newWindow.toDate} onChange={(e) => setNewWindow((p) => ({ ...p, toDate: e.target.value }))} />
            <Input
              className="sm:col-span-2"
              placeholder="Reason (for example Exam week)"
              value={newWindow.reason}
              onChange={(e) => setNewWindow((p) => ({ ...p, reason: e.target.value }))}
            />
          </div>
          <Button type="button" variant="outline" onClick={addWindow}>Add blackout window</Button>
        </div>}

        <div className="flex justify-end">
          <Button onClick={handleSave} loading={isSaving}>{isGroup ? "Save for All Colleges" : "Save Leave Policy"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
