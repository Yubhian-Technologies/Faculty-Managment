"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { WRITTEN, whenLabel } from "@/lib/cea/rules";
import type { CeaPlan, CeaPlanUnit, CeaSettings, CeaWhen } from "@/types";

// CEA plans. HOD: the subjects their department looks after - plan each unit's assessment (type + in class /
// with a Mid). Exam Cell: every subject's progress (and may plan too).

const selectClass = "h-8 rounded-md border border-input bg-background px-2 text-sm";
type Row = { subjectId: string; code: string; name: string; courseName: string; regulation: string; subjectDepartments: string[]; syllabusStatus: string | null; planned: boolean; units: CeaPlanUnit[]; updatedAt: string | null; updatedByName: string | null };

export function CeaPlans({ title, description, tabs }: { title: string; description: string; tabs?: React.ReactNode }) {
  const [d, setD] = useState<{ subjects: Row[]; role: string } | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"" | "TODO" | "DONE">("");
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch("/api/college/cea/subjects").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Unable to load"); setD(j); setError(""); }).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (d?.subjects ?? []).filter((r) => (!show || (show === "DONE") === r.planned) && (!s || `${r.code} ${r.name} ${r.subjectDepartments.join(" ")}`.toLowerCase().includes(s)));
  }, [d, q, show]);
  const done = d?.subjects.filter((r) => r.planned).length ?? 0;

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title={title} description={description} className={tabs ? "mb-0" : undefined} />
      {tabs}
      {error ? <p className="text-sm text-destructive">{error}</p> : !d ? <div className="h-40 animate-pulse rounded-2xl bg-muted/40" /> : d.subjects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No subjects need a CIE plan. CIE is switched on per course and regulation in Exam Cell &gt; Mid Configuration &gt; CIE{d.role === "HOD" ? ", and only subjects your department looks after (Subject Department) are listed here" : ""}.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[14rem] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search" className="pl-8" placeholder="Code, subject, department" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <select aria-label="Show" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
              <option value="">All ({d.subjects.length})</option><option value="TODO">Not planned ({d.subjects.length - done})</option><option value="DONE">Planned ({done})</option>
            </select>
          </div>
          <Card className="rounded-2xl"><CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-3 py-2">Subject</th><th className="px-3 py-2">Course</th><th className="px-3 py-2">Subject Department</th><th className="px-3 py-2">Plan</th><th className="px-3 py-2" /></tr>
              </thead>
              <tbody>{rows.map((r) => (
                <tr key={r.subjectId} className="border-t">
                  <td className="px-3 py-2"><div className="font-medium">{r.name}</div><div className="font-mono text-xs text-muted-foreground">{r.code}</div></td>
                  <td className="px-3 py-2">{r.courseName} · {r.regulation}</td>
                  <td className="px-3 py-2">{r.subjectDepartments.join(", ") || <span className="text-amber-700 dark:text-amber-300">Not set</span>}</td>
                  <td className="px-3 py-2">
                    {r.planned ? <div className="flex flex-wrap gap-1">{r.units.map((u) => <span key={u.unit} className={cn("rounded px-1.5 py-0.5 text-xs", u.when === "CLASS" ? "bg-muted" : "bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-200")}>U{u.unit} {u.when === "CLASS" ? "class" : whenLabel(u.when).replace("With ", "")}</span>)}</div>
                      : r.syllabusStatus !== "FROZEN" ? <span className="text-xs text-muted-foreground">Waiting for the syllabus to be frozen</span>
                      : <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Not planned</span>}
                  </td>
                  <td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => setOpen(r.subjectId)}>{r.planned ? "Open" : "Plan"}</Button></td>
                </tr>
              ))}</tbody>
            </table>
          </CardContent></Card>
        </>
      )}
      {open && <CeaPlanDialog subjectId={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} />}
    </div>
  );
}

type PlanData = { subject: { code: string; name: string; courseName: string; regulation: string }; settings: CeaSettings | null; syllabusStatus: string | null; units: { unit: number; title: string }[]; plan: CeaPlan | null; canEdit: boolean; midCount: number; owners: string[] };

export function CeaPlanDialog({ subjectId, onClose, onSaved }: { subjectId: string; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<PlanData | null>(null);
  const [units, setUnits] = useState<{ unit: number; title: string; typeId: string; when: CeaWhen }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/college/cea/plans/${encodeURIComponent(subjectId)}`).then((r) => r.json()).then((x: PlanData) => {
      setD(x);
      setUnits(x.units.map((u) => { const p = x.plan?.units.find((pu) => pu.unit === u.unit); return { unit: u.unit, title: u.title, typeId: p?.typeId ?? "", when: p?.when ?? "CLASS" }; }));
    }).catch(() => undefined);
  }, [subjectId]);
  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/college/cea/plans/${encodeURIComponent(subjectId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: d?.plan?.version ?? 0, units }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Unable to save");
      toast({ variant: "success", title: "CIE plan saved" }); onSaved();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save" }); }
    finally { setBusy(false); }
  }
  const types = d?.settings?.types ?? [];
  const label = (id: string) => types.find((t) => t.id === id)?.label ?? id;
  const mids = Array.from({ length: d?.midCount ?? 2 }, (_, i) => `MID${i + 1}` as CeaWhen);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>CIE plan{d ? ` - ${d.subject.name}` : ""}</DialogTitle>
          <DialogDescription>{d ? `${d.subject.code} · ${d.subject.courseName} ${d.subject.regulation} · every branch${d.settings ? ` · ${d.settings.unitMarks} marks a unit` : ""}` : "Loading..."}</DialogDescription>
        </DialogHeader>
        {d && !d.settings && <p className="text-sm text-muted-foreground">CIE isn&apos;t switched on for this course and regulation.</p>}
        {d && d.settings && d.syllabusStatus !== "FROZEN" && <p className="text-sm text-amber-700 dark:text-amber-300">The syllabus isn&apos;t frozen yet - its units are what you plan. Academics freeze it after the HOD submits it.</p>}
        {d && d.settings && d.units.length > 0 && (
          <div className="space-y-2">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 pr-2">Unit</th><th className="py-1 pr-2">When</th><th className="py-1">Assessment</th></tr></thead>
              <tbody>{units.map((u, i) => (
                <tr key={u.unit} className="border-t">
                  <td className="py-2 pr-2"><span className="font-medium">Unit {u.unit}</span> <span className="text-muted-foreground">{u.title}</span></td>
                  <td className="py-2 pr-2">
                    {d.canEdit ? (
                      <select aria-label={`Unit ${u.unit} when`} className={selectClass} value={u.when} onChange={(e) => setUnits(units.map((x, j) => (j === i ? { ...x, when: e.target.value as CeaWhen, typeId: e.target.value === "CLASS" ? x.typeId : WRITTEN } : x)))}>
                        <option value="CLASS">In class</option>{mids.map((m) => <option key={m} value={m}>{whenLabel(m)}</option>)}
                      </select>
                    ) : whenLabel(u.when)}
                  </td>
                  <td className="py-2">
                    {u.when !== "CLASS" ? <span>Written test <span className="text-xs text-muted-foreground">({d.settings!.paperMinutes} min paper by the Mid paper setter)</span></span>
                      : d.canEdit ? (
                        <select aria-label={`Unit ${u.unit} type`} className={selectClass} value={u.typeId} onChange={(e) => setUnits(units.map((x, j) => (j === i ? { ...x, typeId: e.target.value } : x)))}>
                          <option value="">Pick</option>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      ) : label(u.typeId)}
                  </td>
                </tr>
              ))}</tbody>
            </table>
            <p className="text-xs text-muted-foreground">In-class units are conducted by each section&apos;s faculty, who enter 0-{d.settings.unitMarks} per student. At most one unit can go with each Mid.</p>
          </div>
        )}
        {d?.plan && (
          <details className="text-xs"><summary className="cursor-pointer font-medium">History</summary>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">{[...d.plan.history].reverse().map((h, i) => <li key={i}>{new Date(h.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {h.byName}: {h.change}</li>)}</ul>
          </details>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {d?.canEdit && d.settings && d.units.length > 0 && <Button onClick={save} disabled={busy || units.some((u) => u.when === "CLASS" && !u.typeId)}>Save plan</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
