"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import { DEFAULT_CEA_TYPES, WRITTEN } from "@/lib/cea/rules";
import type { CeaSettings } from "@/types";

// Exam Cell > Mid Configuration > CEA: Continuous Evaluation per course + regulation (e.g. B.Tech R26).

const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm";
type Course = { courseKey: string; courseName: string; regulations: string[] };

export function CeaSettingsCard() {
  const [d, setD] = useState<{ settings: CeaSettings[]; courses: Course[]; canEdit: boolean } | null>(null);
  const [edit, setEdit] = useState<CeaSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => fetch("/api/college/cea/settings").then((r) => r.json()).then(setD).catch(() => setD({ settings: [], courses: [], canEdit: false }));
  useEffect(() => { load(); }, []);

  async function save() {
    if (!edit) return;
    setBusy(true);
    try {
      const res = await fetch("/api/college/cea/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: edit, version: edit.version }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Couldn't save");
      toast({ variant: "success", title: `CIE saved for ${edit.courseName} ${edit.regulation}` });
      setEdit(null); load();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't save" }); }
    finally { setBusy(false); }
  }

  if (!d) return <div className="h-32 animate-pulse rounded-lg bg-muted" />;
  const startNew = () => setEdit({ id: "", courseKey: "", courseName: "", regulation: "", enabled: true, unitMarks: 10, types: DEFAULT_CEA_TYPES.map((t) => ({ ...t })), paperMinutes: 20, version: 0 });
  const course = d.courses.find((c) => c.courseKey === edit?.courseKey);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Continuous Internal Evaluation (CIE)</CardTitle>
        <CardDescription>Per course and regulation: every unit has one assessment worth the marks below. The Subject Department plans each unit&apos;s type and when it is held - in class, or as a separate written paper in a Mid&apos;s sitting (set by the Mid paper setter). The units add up and scale to the internal-marks component linked to CIE.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {d.settings.length === 0 ? <p className="text-sm text-muted-foreground">No course has CIE yet.</p> : (
          <ul className="divide-y rounded-md border text-sm">{d.settings.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="font-medium">{s.courseName} · {s.regulation}</span>
              <span className={s.enabled ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}>{s.enabled ? "On" : "Off"}</span>
              <span className="text-muted-foreground">{s.unitMarks} per unit · paper {s.paperMinutes} min · {s.types.length} types</span>
              <span className="flex-1" />
              {d.canEdit && <Button size="sm" variant="ghost" onClick={() => setEdit(structuredClone(s))}>Edit</Button>}
            </li>
          ))}</ul>
        )}
        {d.canEdit && !edit && <Button variant="outline" onClick={startNew}><Plus className="mr-1.5 h-4 w-4" />Add a course</Button>}
        {edit && (
          <div className="space-y-3 rounded-lg border p-4">
            {edit.version === 0 && (
              <div className="flex flex-wrap gap-3">
                <div className="space-y-1"><Label htmlFor="cea-course">Course</Label>
                  <select id="cea-course" className={selectClass} value={edit.courseKey} onChange={(e) => { const c = d.courses.find((x) => x.courseKey === e.target.value); setEdit({ ...edit, courseKey: e.target.value, courseName: c?.courseName ?? "", regulation: "" }); }}>
                    <option value="">Pick</option>{d.courses.map((c) => <option key={c.courseKey} value={c.courseKey}>{c.courseName}</option>)}
                  </select>
                </div>
                <div className="space-y-1"><Label htmlFor="cea-reg">Regulation</Label>
                  <select id="cea-reg" className={selectClass} value={edit.regulation} onChange={(e) => setEdit({ ...edit, regulation: e.target.value })}>
                    <option value="">Pick</option>{(course?.regulations ?? []).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
            )}
            {edit.version > 0 && <p className="text-sm font-medium">{edit.courseName} · {edit.regulation}</p>}
            <div className="flex flex-wrap items-end gap-3">
              {([["Marks per unit", "unitMarks"], ["With-Mid paper time (min)", "paperMinutes"]] as const).map(([l, k]) => (
                <div key={k} className="space-y-1"><Label className="text-xs">{l}</Label><Input className="h-8 w-28" inputMode="numeric" value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })} /></div>
              ))}
              <label className="flex items-center gap-2 pb-1.5 text-sm"><Checkbox checked={edit.enabled} onCheckedChange={(c) => setEdit({ ...edit, enabled: !!c })} />On</label>
            </div>
            <p className="text-xs text-muted-foreground">A with-Mid CIE paper carries the unit&apos;s marks ({edit.unitMarks}); the Mid paper setter decides its questions and the marks of each.</p>
            <p className="text-xs text-muted-foreground">The units add up and scale to the internal-marks component you link to CIE (Marks tab: &quot;From CIE&quot;) - e.g. 5 units x 10 = 50 into a 30-mark component: 42 becomes 25.2. A with-Mid paper&apos;s time comes out of that Mid&apos;s sitting (90 min = 20 CIE + 70 Mid).</p>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Assessment types</p>
              {edit.types.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input aria-label="Type" className="h-8 w-56" value={t.label} onChange={(e) => setEdit({ ...edit, types: edit.types.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  {t.id === WRITTEN ? <span className="text-xs text-muted-foreground">used for with-Mid units</span>
                    : <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setEdit({ ...edit, types: edit.types.filter((_, j) => j !== i) })}>Remove</Button>}
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setEdit({ ...edit, types: [...edit.types, { id: "", label: "" }] })}>Add type</Button>
            </div>
            <div className="flex gap-2"><Button onClick={save} disabled={busy || !edit.courseKey || !edit.regulation}>Save</Button><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
