"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";
import { toast } from "@/hooks/useToast";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import type {
  EffectiveLeaveCategory, LeaveTypeCode, LeaveTypeRuleOverride, LeaveBlackoutWindow, LeaveProofRouteTarget,
} from "@/types/leave";
import { EFFECTIVE_CATEGORY_LABELS } from "@/types/leave";
import type { FacultyNorms } from "@/types/core";

type Overrides = Partial<Record<LeaveTypeCode, LeaveTypeRuleOverride>>;

const GENDERS: ("Male" | "Female" | "Other")[] = ["Male", "Female", "Other"];

// Settings > "Leave Policy" - per-college customization of the 6 built-in
// leave types' rules (limits, carry-forward, half-day, reason dropdown,
// consecutive-day/notice/frequency caps, gender/escalation rules) plus
// college-wide blackout windows - see resolveLeaveTypes.ts. Saved on its own
// (not the page's main Save button), same convention as
// LeaveApprovalRoutingCard. A field left blank/unchecked for a type simply
// isn't sent as part of that type's override, so it falls back to the
// built-in seed default (src/lib/leave/seedData.ts) - a college that never
// opens this card sees no behavior change at all.
export function LeaveTypeRulesCard() {
  const [overrides, setOverrides] = useState<Overrides>({});
  const [windows, setWindows] = useState<LeaveBlackoutWindow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [reasonDraft, setReasonDraft] = useState<Partial<Record<LeaveTypeCode, string>>>({});
  const [reasonProofDraft, setReasonProofDraft] = useState<Partial<Record<LeaveTypeCode, LeaveProofRouteTarget>>>({});
  const [newWindow, setNewWindow] = useState({ fromDate: "", toDate: "", reason: "" });

  useEffect(() => {
    fetch("/api/college/settings/general")
      .then((r) => r.json() as Promise<{ settings: FacultyNorms }>)
      .then(({ settings }) => {
        setOverrides(settings.leaveTypeRuleOverrides ?? {});
        setWindows(settings.leaveBlackoutWindows ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load leave policy" }))
      .finally(() => setIsLoading(false));
  }, []);

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
      const res = await fetch("/api/college/settings/general", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaveTypeRuleOverrides: overrides, leaveBlackoutWindows: windows }),
      });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? "Failed to save");
      }
      toast({ variant: "success", title: "Leave policy saved" });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to save" });
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
        <CardTitle className="text-base">Leave Policy</CardTitle>
        <CardDescription>
          Customize each leave type&rsquo;s limits, carry-forward, half-day and reason rules for your college. Anything left
          blank keeps the built-in default.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Accordion type="multiple" className="rounded-lg border">
          {LEAVE_TYPE_SEED.map((lt) => {
            const o = overrides[lt.code] ?? {};
            return (
              <AccordionItem key={lt.code} value={lt.code} className="px-3">
                <AccordionTrigger>
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{lt.label}</span>
                    <span className="text-xs text-muted-foreground">({lt.shortLabel})</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pb-4">
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

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`${lt.code}-half`}
                      checked={!!o.halfDayAllowed}
                      onCheckedChange={(c) => patch(lt.code, { halfDayAllowed: !!c })}
                    />
                    <Label htmlFor={`${lt.code}-half`} className="text-sm font-normal">Half day allowed</Label>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Max consecutive days</Label>
                      <Input
                        type="number" min={1}
                        value={o.maxConsecutiveDays ?? ""}
                        onChange={(e) => patch(lt.code, { maxConsecutiveDays: e.target.value === "" ? undefined : Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Min advance notice (days)</Label>
                      <Input
                        type="number" min={0}
                        value={o.minAdvanceNoticeDays ?? ""}
                        onChange={(e) => patch(lt.code, { minAdvanceNoticeDays: e.target.value === "" ? undefined : Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Max requests / month</Label>
                      <Input
                        type="number" min={1}
                        value={o.maxRequestsPerMonth ?? ""}
                        onChange={(e) => patch(lt.code, { maxRequestsPerMonth: e.target.value === "" ? undefined : Number(e.target.value) })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Escalate to Principal (skip HOD) when...</Label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Longer than (days)</Label>
                        <Input
                          type="number" min={1}
                          value={o.escalateAfterDays ?? ""}
                          onChange={(e) => patch(lt.code, { escalateAfterDays: e.target.value === "" ? undefined : Number(e.target.value) })}
                        />
                      </div>
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
                    </div>
                  </div>

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
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        <div className="space-y-2 border-t pt-4">
          <Label className="text-sm font-medium">Blackout windows</Label>
          <p className="text-xs text-muted-foreground">
            Date ranges leave can&rsquo;t be applied over (e.g. exam week). Leave &ldquo;applies to&rdquo; unset to block every
            leave type, including &ldquo;Other&rdquo; requests.
          </p>
          {windows.length > 0 && (
            <div className="divide-y rounded-lg border">
              {windows.map((w) => (
                <div key={w.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{w.fromDate} → {w.toDate}</span>
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
              placeholder="Reason (e.g. Exam week)"
              value={newWindow.reason}
              onChange={(e) => setNewWindow((p) => ({ ...p, reason: e.target.value }))}
            />
          </div>
          <Button type="button" variant="outline" onClick={addWindow}>Add blackout window</Button>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} loading={isSaving}>Save Leave Policy</Button>
        </div>
      </CardContent>
    </Card>
  );
}
