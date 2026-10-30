"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import { DESIGNATION_LABELS } from "@/types";
import { DUTY_CATEGORIES, DUTY_CATEGORY_LABELS, type DesignationLimit, type DutyCategory, type InvigilationRules, type RuleMode } from "@/types/invigilation";
import type { Overview } from "./model";

// Exam Cell > Invigilation > Configuration: every rule of one schedule. Nothing
// here is fixed in code - the defaults are only a starting point.

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const num = (v: string) => (v.trim() === "" ? null : Number(v));

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div><Label htmlFor={id}>{label}</Label>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ModeSelect({ id, value, onChange, off = true }: { id: string; value: RuleMode; onChange: (v: RuleMode) => void; off?: boolean }) {
  return (
    <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value as RuleMode)}>
      <option value="HARD">Block</option>
      <option value="WARN">Warn - needs an override</option>
      {off && <option value="OFF">Allow</option>}
    </select>
  );
}

export function RulesForm({ overview, approvers, mids, departments, onSaved }: {
  overview: Overview;
  approvers: { uid: string; name: string }[];
  mids: { id: string; label: string }[];
  departments: string[];
  onSaved: () => void;
}) {
  const s = overview.schedule;
  const [r, setR] = useState<InvigilationRules>(s.rules);
  const [name, setName] = useState(s.name);
  const [midPlanIds, setMidPlanIds] = useState<string[]>(s.midPlanIds);
  const [status, setStatus] = useState(s.status);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof InvigilationRules>(k: K, v: InvigilationRules[K]) => setR((x) => ({ ...x, [k]: v }));
  const setLimit = (i: number, patch: Partial<DesignationLimit>) => set("limits", r.limits.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const designations = Object.entries(DESIGNATION_LABELS);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/college/invigilation/schedules/${s.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, midPlanIds, status, rules: r }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      toast({ variant: "success", title: "Configuration saved" });
      onSaved();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Section title="Examination schedule" description="What this schedule covers. Changing the Mid timetables changes the duties needed; duties already given stay.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="r-name">Name</Label><Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="r-status">Status</Label>
            <select id="r-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="ACTIVE">Active - duties can be given</option>
              <option value="CLOSED">Closed - read only</option>
            </select>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {mids.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={midPlanIds.includes(m.id)} onCheckedChange={(v) => setMidPlanIds((p) => (v ? [...p, m.id] : p.filter((x) => x !== m.id)))} />{m.label}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Duty categories and numbers" description="Invigilators per room go by the students seated there; relievers by the rooms in use in a session.">
        <div className="grid gap-3 sm:grid-cols-3">
          {DUTY_CATEGORIES.map((c) => (
            <Toggle key={c} id={`r-cat-${c}`} label={DUTY_CATEGORY_LABELS[c]} checked={r.categories[c]} onChange={(v) => set("categories", { ...r.categories, [c]: v })} />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <div className="space-y-1.5"><Label htmlFor="r-spi">Students per invigilator</Label><Input id="r-spi" type="number" min={1} value={r.studentsPerInvigilator} onChange={(e) => set("studentsPerInvigilator", Number(e.target.value))} /></div>
          <div className="space-y-1.5"><Label htmlFor="r-min">Min per room</Label><Input id="r-min" type="number" min={0} value={r.minPerRoom} onChange={(e) => set("minPerRoom", Number(e.target.value))} /></div>
          <div className="space-y-1.5"><Label htmlFor="r-max">Max per room</Label><Input id="r-max" type="number" min={1} value={r.maxPerRoom} onChange={(e) => set("maxPerRoom", Number(e.target.value))} /></div>
          <div className="space-y-1.5"><Label htmlFor="r-rpr">Rooms per reliever</Label><Input id="r-rpr" type="number" min={1} value={r.roomsPerReliever} onChange={(e) => set("roomsPerReliever", Number(e.target.value))} /></div>
          <div className="space-y-1.5"><Label htmlFor="r-sq">Special squad per session</Label><Input id="r-sq" type="number" min={0} value={r.squadPerSession} onChange={(e) => set("squadPerSession", Number(e.target.value))} /></div>
        </div>
      </Section>

      <Section title="Designation-wise limits" description="Blank = no limit. A row with no designation applies to every designation not listed. Block refuses; Warn needs an override by an approver.">
        <div className="space-y-1.5">
          <Label>Duties that count towards workload and limits</Label>
          <div className="flex flex-wrap gap-4">
            {DUTY_CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <Checkbox checked={r.countCategories.includes(c)} onCheckedChange={(v) => set("countCategories", v ? [...r.countCategories, c] : r.countCategories.filter((x) => x !== c))} />{DUTY_CATEGORY_LABELS[c]}
              </label>
            ))}
          </div>
        </div>
        {r.limits.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="p-2">Designation</th><th className="p-2">Per schedule</th><th className="p-2">Per day</th>{DUTY_CATEGORIES.map((c) => <th key={c} className="p-2">{DUTY_CATEGORY_LABELS[c]}</th>)}<th className="p-2">When exceeded</th><th className="p-2" /></tr>
              </thead>
              <tbody>
                {r.limits.map((l, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">
                      <select aria-label="Designation" className={selectClass} value={l.designation} onChange={(e) => setLimit(i, { designation: e.target.value })}>
                        <option value="">Every other designation</option>
                        {designations.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                    <td className="p-2"><Input aria-label="Per schedule" type="number" min={0} value={l.perSchedule ?? ""} onChange={(e) => setLimit(i, { perSchedule: num(e.target.value) })} /></td>
                    <td className="p-2"><Input aria-label="Per day" type="number" min={0} value={l.perDay ?? ""} onChange={(e) => setLimit(i, { perDay: num(e.target.value) })} /></td>
                    {DUTY_CATEGORIES.map((c: DutyCategory) => (
                      <td key={c} className="p-2"><Input aria-label={DUTY_CATEGORY_LABELS[c]} type="number" min={0} value={l.byCategory?.[c] ?? ""} onChange={(e) => setLimit(i, { byCategory: { ...(l.byCategory ?? {}), [c]: num(e.target.value) } })} /></td>
                    ))}
                    <td className="p-2"><ModeSelect id={`r-lim-${i}`} value={l.mode} off={false} onChange={(v) => setLimit(i, { mode: v === "WARN" ? "WARN" : "HARD" })} /></td>
                    <td className="p-2"><Button size="icon" variant="ghost" aria-label="Remove limit" onClick={() => set("limits", r.limits.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Button variant="outline" size="sm" onClick={() => set("limits", [...r.limits, { designation: "", perSchedule: null, perDay: null, byCategory: {}, mode: "HARD" }])}><Plus className="mr-1 h-4 w-4" />Add limit</Button>
      </Section>

      <Section title="Availability" description="Faculty are judged against the teaching timetable (published and draft), approved leave and their other duties.">
        <Toggle id="r-tt" label="Check the teaching timetable" checked={r.timetableCheck} onChange={(v) => set("timetableCheck", v)} />
        <Toggle id="r-susp" label="Classes of the year writing are suspended" hint="On an exam day, the classes of the course + year writing that day don't make anyone busy." checked={r.suspendExamYearClasses} onChange={(v) => set("suspendExamYearClasses", v)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="r-miss">Faculty with no timetable</Label>
            <select id="r-miss" className={selectClass} value={r.missingTimetable} onChange={(e) => set("missingTimetable", e.target.value as InvigilationRules["missingTimetable"])}>
              <option value="WARN">Flag - needs an override (check first)</option>
              <option value="HARD">Block</option>
              <option value="ALLOW">Treat as free</option>
            </select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="r-buf">Minutes between a class / duty and the next duty</Label><Input id="r-buf" type="number" min={0} value={r.bufferMinutes} onChange={(e) => set("bufferMinutes", Number(e.target.value))} /></div>
        </div>
        <p className="text-xs text-muted-foreground">Two duties at overlapping times are always refused.</p>
      </Section>

      <Section title="Subject restrictions" description="From teaching assignments. Always refused when on - not overridable.">
        <Toggle id="r-sub-now" label="Faculty teaching a subject written there can't invigilate it" checked={r.excludeCurrentSubjectFaculty} onChange={(v) => set("excludeCurrentSubjectFaculty", v)} />
        <Toggle id="r-sub-past" label="Also faculty who taught it before" hint="Teaching assignments marked as past." checked={r.excludePastSubjectFaculty} onChange={(v) => set("excludePastSubjectFaculty", v)} />
        <div className="space-y-1.5">
          <Label>Departments whose faculty are not given duties</Label>
          <div className="grid max-h-48 gap-2 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
            {departments.map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm">
                <Checkbox checked={r.excludeDepartments.includes(d)} onCheckedChange={(v) => set("excludeDepartments", v ? [...r.excludeDepartments, d] : r.excludeDepartments.filter((x) => x !== d))} />{d}
              </label>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Room rotation">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="r-same">Same room again in this schedule</Label><ModeSelect id="r-same" value={r.sameRoomRule} onChange={(v) => set("sameRoomRule", v)} /></div>
          <div className="space-y-1.5"><Label htmlFor="r-cons">Same room in consecutive sessions</Label><ModeSelect id="r-cons" value={r.consecutiveSameRoomRule} onChange={(v) => set("consecutiveSameRoomRule", v)} /></div>
        </div>
        <p className="text-xs text-muted-foreground">Suggestions already prefer people who haven&rsquo;t had the room.</p>
      </Section>

      <Section title="Overrides and approvals" description="Only these Exam Cell users may give a duty that breaks a Warn rule; each override needs a reason and is kept in the audit log. Block rules can't be overridden.">
        {approvers.length === 0 ? <p className="text-sm text-muted-foreground">No Exam Cell logins found.</p> : (
          <div className="grid gap-2 sm:grid-cols-2">
            {approvers.map((a) => (
              <label key={a.uid} className="flex items-center gap-2 text-sm">
                <Checkbox checked={r.approverUids.includes(a.uid)} onCheckedChange={(v) => set("approverUids", v ? [...r.approverUids, a.uid] : r.approverUids.filter((x) => x !== a.uid))} />{a.name}
              </label>
            ))}
          </div>
        )}
      </Section>

      <div className="flex justify-end"><Button onClick={() => void save()} loading={saving}>Save configuration</Button></div>
    </div>
  );
}
