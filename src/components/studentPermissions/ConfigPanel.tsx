"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Save, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { loadConfig, saveConfig, type ConfigPayload } from "./api";
import { addStage, getRoute, isDisabled, moveStage, removeStage, setLimit, setRoute, setTypeDisabled, type PermissionRuleSet } from "@/lib/studentPermissions/ruleSetOps";
import type { PermissionConfig, PermissionStage } from "@/lib/studentPermissions/types";

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
      {chain.map((stage, i) => (
        <span key={stage} className="inline-flex items-center gap-0.5 rounded-full border bg-muted/40 pl-2.5 pr-1 py-0.5 text-xs">
          <span className="text-muted-foreground mr-1">{i + 1}.</span>{labels[stage as PermissionStage] ?? stage}
          <button type="button" aria-label="Move earlier" disabled={i === 0} onClick={() => onChange(moveStage(chain, i, -1))} className="p-0.5 disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
          <button type="button" aria-label="Move later" disabled={i === chain.length - 1} onClick={() => onChange(moveStage(chain, i, 1))} className="p-0.5 disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
          <button type="button" aria-label={`Remove ${stage}`} onClick={() => onChange(removeStage(chain, stage))} className="p-0.5"><X className="h-3 w-3" /></button>
        </span>
      ))}
      {free.length > 0 && (
        <Select value="" onValueChange={(v) => onChange(addStage(chain, v))}>
          <SelectTrigger className="h-7 w-auto gap-1 px-2 text-xs"><Plus className="h-3 w-3" /><SelectValue placeholder="Add approver" /></SelectTrigger>
          <SelectContent>{free.map((s) => <SelectItem key={s} value={s}>{labels[s]}</SelectItem>)}</SelectContent>
        </Select>
      )}
    </div>
  );
}

function RuleSetEditor({ rs, onChange, data, inherited }: {
  rs: PermissionRuleSet; onChange: (rs: PermissionRuleSet) => void; data: ConfigPayload; inherited: boolean;
}) {
  const numberField = (label: string, key: "maxDays" | "advanceNoticeHours" | "maxStudentsPerRequest", fallback: number) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={0} className="h-8" value={rs.limits?.[key] ?? ""} placeholder={String(fallback)}
        onChange={(e) => onChange(setLimit(rs, key, e.target.value === "" ? undefined : Math.max(0, Number(e.target.value))))} />
    </div>
  );
  return (
    <div className="space-y-5">
      {REQUESTERS.map(({ type, label }) => (
        <div key={type} className="space-y-2">
          <h4 className="text-sm font-semibold">{label}</h4>
          <div className="rounded-md border p-3 space-y-1">
            <p className="text-xs font-medium">All request types (default)</p>
            <ChainEditor chain={getRoute(rs, type, "*")} allowed={data.stages[type]} labels={data.stageLabels}
              placeholder={inherited ? "Inherits the college route" : `Built-in: ${data.defaults.route[type].map((s) => data.stageLabels[s]).join(" → ")}`}
              onChange={(c) => onChange(setRoute(rs, type, "*", c))} />
          </div>
          <div className="space-y-2">
            {data.groups.map((g) => (
              <div key={g.id} className="rounded-md border p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium">{g.label}</p>
                  {type === "STUDENT" && (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      Enabled
                      <Switch checked={!isDisabled(rs, g.id)} onCheckedChange={(on) => onChange(setTypeDisabled(rs, g.id, !on))} aria-label={`Enable ${g.label}`} />
                    </label>
                  )}
                </div>
                <ChainEditor chain={getRoute(rs, type, g.id)} allowed={data.stages[type]} labels={data.stageLabels}
                  placeholder="Uses the default route above" onChange={(c) => onChange(setRoute(rs, type, g.id, c))} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Limits</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {numberField("Longest request (days)", "maxDays", data.defaults.limits.maxDays)}
          {numberField("Preferred notice (hours)", "advanceNoticeHours", data.defaults.limits.advanceNoticeHours)}
          {numberField("Students per request", "maxStudentsPerRequest", data.defaults.limits.maxStudentsPerRequest)}
          <div className="space-y-1">
            <Label className="text-xs">Proof required</Label>
            <div className="h-8 flex items-center">
              <Switch checked={rs.limits?.proofRequired ?? data.defaults.limits.proofRequired} onCheckedChange={(v) => onChange(setLimit(rs, "proofRequired", v))} aria-label="Proof required" />
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Empty fields inherit. A request raised with less than the preferred notice is flagged as late, not refused.</p>
      </div>
    </div>
  );
}

export function ConfigPanel() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["student-permission-config"], queryFn: loadConfig });
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

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data || !config) return <p className="text-sm text-red-600">{(error as Error)?.message ?? "Could not load the configuration"}</p>;
  if (editable.length === 0) return <p className="text-sm text-muted-foreground">You don&apos;t have access to configure permission routing. Ask the Principal to enable it for your department.</p>;

  const active = scope && editable.includes(scope) ? scope : editable[0];
  const isCollege = active === COLLEGE;
  const principal = data.editor.college;
  const dept = isCollege ? null : config.departments[active] ?? { hodCanConfigure: false };
  const rs: PermissionRuleSet = isCollege ? config.college : dept?.override ?? {};

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
        <CardContent className="p-4 flex flex-wrap items-end gap-4">
          <div className="space-y-1 min-w-[14rem]">
            <Label className="text-xs">Configuring</Label>
            <Select value={active} onValueChange={setScope}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {editable.map((s) => <SelectItem key={s} value={s}>{s === COLLEGE ? "College defaults" : s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {principal && isCollege && (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={config.enabled} onCheckedChange={(v) => update((c) => ({ ...c, enabled: v }))} aria-label="Permission requests enabled" />
              Permission requests enabled
            </label>
          )}
          {principal && !isCollege && (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!!dept?.hodCanConfigure}
                onCheckedChange={(v) => update((c) => ({ ...c, departments: { ...c.departments, [active]: { ...(c.departments[active] ?? {}), hodCanConfigure: v } } }))}
                aria-label="Let the HOD configure this department" />
              Let the HOD configure {active}
            </label>
          )}
          {!principal && <Badge variant="secondary">Delegated by the Principal</Badge>}
          <div className="ml-auto">
            <Button onClick={save} disabled={!draft || saving}><Save className="h-4 w-4 mr-1.5" />{saving ? "Saving…" : "Save changes"}</Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <RuleSetEditor rs={rs} onChange={setRuleSet} data={data} inherited={!isCollege} />
        </CardContent>
      </Card>
    </div>
  );
}
