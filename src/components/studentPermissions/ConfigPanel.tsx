"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Save, ShieldCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { loadConfig, saveConfig, type ConfigPayload } from "./api";
import { EmptyState, ListSkeleton, LoadError } from "./statusBadge";
import { addStage, getRoute, isDisabled, moveStage, removeStage, setLimit, setProofForType, setRequestersForType, setRoute, setTypeDisabled, type PermissionRuleSet } from "@/lib/studentPermissions/ruleSetOps";
import type { PermissionConfig, PermissionStage } from "@/lib/studentPermissions/types";
import { resolveProofRequired } from "@/lib/studentPermissions/rules";
import { REQUESTER_ROLE_LABELS } from "@/lib/studentPermissions/roles";

// Routing configuration: who approves which request type, per department.
// The Principal edits the college defaults and every department, and decides
// which HODs may edit their own department. A delegated HOD sees only their
// department(s). The server re-checks every edit; this screen only hides what
// the viewer can't change.

const COLLEGE = "__college__";
const REQUESTERS: { type: "STUDENT" | "FACULTY"; label: string }[] = [
  { type: "STUDENT", label: "Raised by the student" },
  { type: "FACULTY", label: "Raised by faculty for students" },
];

function ChainEditor({ chain, allowed, labels, onChange, placeholder }: {
  chain: string[]; allowed: PermissionStage[]; labels: Record<PermissionStage, string>;
  onChange: (c: string[]) => void; placeholder: string;
}) {
  const free = allowed.filter((s) => !chain.includes(s));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chain.length === 0 && <span className="text-xs text-muted-foreground">{placeholder}</span>}
      {chain.map((stage, i) => {
        const label = labels[stage as PermissionStage] ?? stage;
        // 36px tap targets on a phone (the icons themselves stay small), tight again from `sm`.
        const iconBtn = "inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 disabled:hover:bg-transparent sm:h-7 sm:w-7";
        return (
          <span key={stage} className="inline-flex items-center gap-0.5 rounded-md border bg-muted/40 py-0.5 pl-2.5 pr-0.5 text-sm sm:text-xs">
            <span className="text-muted-foreground mr-1">{i + 1}.</span><span className="mr-1">{label}</span>
            <button type="button" aria-label={`Move ${label} earlier`} disabled={i === 0} onClick={() => onChange(moveStage(chain, i, -1))} className={iconBtn}><ArrowUp className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label={`Move ${label} later`} disabled={i === chain.length - 1} onClick={() => onChange(moveStage(chain, i, 1))} className={iconBtn}><ArrowDown className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label={`Remove ${label}`} onClick={() => onChange(removeStage(chain, stage))} className={`${iconBtn} text-muted-foreground hover:text-destructive`}><X className="h-3.5 w-3.5" /></button>
          </span>
        );
      })}
      {free.length > 0 && (
        <Select value="" onValueChange={(v) => onChange(addStage(chain, v))}>
          <SelectTrigger className="h-10 w-auto gap-1 px-3 text-sm sm:h-7 sm:px-2 sm:text-xs"><Plus className="h-3.5 w-3.5" /><SelectValue placeholder="Add approver" /></SelectTrigger>
          <SelectContent>{free.map((s) => <SelectItem key={s} value={s}>{labels[s]}</SelectItem>)}</SelectContent>
        </Select>
      )}
    </div>
  );
}

function RuleSetEditor({ rs, onChange, data, inherited }: {
  rs: PermissionRuleSet; onChange: (rs: PermissionRuleSet) => void; data: ConfigPayload; inherited: boolean;
}) {
  const [sel, setSel] = useState("*"); // "*" = the default for every type; otherwise a group id or an item id
  const numberField = (label: string, key: "maxDays" | "advanceNoticeHours" | "maxStudentsPerRequest" | "maxBackdateDays", fallback: number) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={0} inputMode="numeric" className="h-11 sm:h-8" value={rs.limits?.[key] ?? ""} placeholder={String(fallback)}
        onChange={(e) => onChange(setLimit(rs, key, e.target.value === "" ? undefined : Math.max(0, Number(e.target.value))))} />
    </div>
  );

  const entities = data.groups.flatMap((g) => [{ id: g.id, label: `All ${g.label}`, keys: [g.id] }, ...g.items.map((i) => ({ id: i.id, label: i.label, keys: [i.id, g.id] }))]);
  const entity = entities.find((e) => e.id === sel);
  const allowed = entity ? entity.keys.map((k) => rs.limits?.requestersByType?.[k]).find((r) => r?.length) ?? [] : [];
  const proof = entity ? resolveProofRequired([rs.limits], entity.keys) : true;
  const showType = (type: "STUDENT" | "FACULTY") => allowed.length === 0 || allowed.some((r) => (r === "STUDENT") === (type === "STUDENT"));
  const chains = (key: string, types: typeof REQUESTERS) => types.map(({ type, label }) => (
    <div key={type} className="space-y-1">
      <p className="text-xs font-medium">{label}</p>
      <ChainEditor chain={getRoute(rs, type, key)} allowed={data.stages[type]} labels={data.stageLabels}
        placeholder={key === "*"
          ? (inherited ? "Inherits the college route" : `Built-in: ${data.defaults.route[type].map((s) => data.stageLabels[s]).join(" → ")}`)
          : "Uses the default route"}
        onChange={(c) => onChange(setRoute(rs, type, key, c))} />
    </div>
  ));

  return (
    <div className="space-y-5">
      <div className="space-y-1 max-w-md">
        <Label className="text-xs">Permission type</Label>
        <Select value={sel} onValueChange={setSel}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="*">All types (default route)</SelectItem>
            {data.groups.map((g) => (
              <div key={g.id}>
                <SelectItem value={g.id}>{`All ${g.label}`}</SelectItem>
                {g.items.map((i) => <SelectItem key={i.id} value={i.id}><span className="pl-3">{i.label}</span></SelectItem>)}
              </div>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!entity && <div className="rounded-md border p-3 space-y-3"><p className="text-sm font-semibold">Default approval route</p>{chains("*", REQUESTERS)}</div>}

      {entity && (
        <div className="rounded-md border p-3 space-y-4">
          <p className="text-sm font-semibold">{entity.label}</p>
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:gap-6">
            <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 text-sm sm:min-h-0 sm:justify-start sm:border-0 sm:px-0">
              Enabled
              <Switch checked={!isDisabled(rs, entity.id)} onCheckedChange={(on) => onChange(setTypeDisabled(rs, entity.id, !on))} aria-label="Enabled" />
            </label>
            <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 text-sm sm:min-h-0 sm:justify-start sm:border-0 sm:px-0">
              Proof required
              <Switch checked={proof} onCheckedChange={(v) => onChange(setProofForType(rs, entity.id, v))} aria-label="Proof required" />
            </label>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium">Who can request <span className="font-normal text-muted-foreground">(none ticked = anyone)</span></p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(REQUESTER_ROLE_LABELS).map(([role, label]) => (
                <label key={role} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm sm:min-h-8 sm:px-2.5 sm:text-xs ${allowed.includes(role) ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted/50"}`}>
                  <input type="checkbox" className="h-4 w-4" checked={allowed.includes(role)}
                    onChange={(e) => onChange(setRequestersForType(rs, entity.id, e.target.checked ? [...allowed, role] : allowed.filter((r) => r !== role)))} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium">Who approves, in order</p>
            <div className="space-y-3">{chains(entity.id, REQUESTERS.filter((r) => showType(r.type)))}</div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Limits</h4>
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-4 gap-3">
          {numberField("Longest request (days)", "maxDays", data.defaults.limits.maxDays)}
          {numberField("Preferred notice (hours)", "advanceNoticeHours", data.defaults.limits.advanceNoticeHours)}
          {numberField("Students per request", "maxStudentsPerRequest", data.defaults.limits.maxStudentsPerRequest)}
          {numberField("Can start up to (days ago)", "maxBackdateDays", data.defaults.limits.maxBackdateDays)}
        </div>
        <p className="text-xs text-muted-foreground">Empty fields inherit. A request raised with less than the preferred notice is flagged as late, not refused.</p>
      </div>
    </div>
  );
}

export function ConfigPanel() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["student-permission-config"], queryFn: loadConfig });
  const [draft, setDraft] = useState<PermissionConfig | null>(null);
  const [scope, setScope] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const config = draft ?? data?.config;
  const editable = useMemo(() => {
    if (!data) return [] as string[];
    const out: string[] = data.editor.college ? [COLLEGE] : [];
    const depts = data.editor.departments === "ALL" ? data.departments : data.editor.departments;
    return out.concat(depts);
  }, [data]);

  if (isLoading) return <ListSkeleton rows={2} />;
  if (error || !data || !config) return <LoadError message={(error as Error)?.message ?? "Could not load the configuration"} onRetry={() => void refetch()} />;
  if (editable.length === 0) return <EmptyState icon={ShieldCheck} headline="You don't have access to configure permission routing." hint="Ask the Principal to enable it for your department." />;

  const active = scope && editable.includes(scope) ? scope : editable[0];
  const isCollege = active === COLLEGE;
  const principal = data.editor.college;
  const dept = isCollege ? null : config.departments[active] ?? { hodCanConfigure: false };
  const rs: PermissionRuleSet = isCollege ? config.college : dept?.override ?? {};

  // A department handed to its HOD is theirs to edit: the Principal / VP withdraw the delegation (and save) first.
  const delegated = principal && !isCollege && !!data.config.departments[active]?.hodCanConfigure;
  const update = (fn: (c: PermissionConfig) => PermissionConfig) => setDraft(fn(config));
  const setRuleSet = (next: PermissionRuleSet) =>
    update((c) => (isCollege ? { ...c, college: next } : { ...c, departments: { ...c.departments, [active]: { hodCanConfigure: !!dept?.hodCanConfigure, override: next } } }));

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await saveConfig(draft);
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ["student-permission-config"] });
      toast({ title: "Routing saved" });
    } catch (e) {
      toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="w-full space-y-1 sm:w-auto sm:min-w-56">
            <Label className="text-xs">Configuring</Label>
            <Select value={active} onValueChange={setScope}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {editable.map((s) => <SelectItem key={s} value={s}>{s === COLLEGE ? "College defaults" : s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {principal && isCollege && (
            <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 text-sm sm:min-h-0 sm:justify-start sm:border-0 sm:px-0">
              Permission requests enabled
              <Switch checked={config.enabled} onCheckedChange={(v) => update((c) => ({ ...c, enabled: v }))} aria-label="Permission requests enabled" />
            </label>
          )}
          {principal && !isCollege && (
            <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 text-sm sm:min-h-0 sm:justify-start sm:border-0 sm:px-0">
              <span className="min-w-0 break-words">Let the HOD configure {active}</span>
              <Switch checked={!!dept?.hodCanConfigure}
                onCheckedChange={(v) => update((c) => ({ ...c, departments: { ...c.departments, [active]: { ...(c.departments[active] ?? {}), hodCanConfigure: v } } }))}
                aria-label="Let the HOD configure this department" />
            </label>
          )}
          {!principal && <Badge variant="secondary" className="w-fit">Delegated by the Principal</Badge>}
          {/* The desktop Save sits in the bar; on a phone the sticky copy below stays in reach while scrolling. */}
          <div className="hidden sm:ml-auto sm:block">
            <Button onClick={save} disabled={!draft || saving}>
              <Save className="h-4 w-4 mr-1.5" aria-hidden />{saving ? "Saving…" : draft ? "Save changes" : "No changes"}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 space-y-3">
          {delegated && <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">{active} is delegated to its HOD, who manages these rules. To edit them here, switch off &quot;Let the HOD configure&quot; and save first.</p>}
          <fieldset disabled={delegated} className={delegated ? "opacity-60" : ""}>
            <RuleSetEditor rs={rs} onChange={setRuleSet} data={data} inherited={!isCollege} />
          </fieldset>
        </CardContent>
      </Card>
      {draft && (
        <div className="sticky bottom-2 z-10 flex items-center gap-3 rounded-lg border bg-background/95 p-3 shadow-md backdrop-blur sm:hidden" role="status">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">You have unsaved changes.</p>
          <Button onClick={save} disabled={saving} className="min-h-11">
            <Save className="h-4 w-4 mr-1.5" aria-hidden />{saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
    </div>
  );
}
