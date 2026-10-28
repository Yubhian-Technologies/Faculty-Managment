"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Download, Eraser, Plus, Save, Send, Sparkles, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MidTimetableSheet } from "@/components/midTimetable/MidTimetableSheet";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import { autoFill, checkSlots, dayLabel, MAX_SESSIONS, timeLabel, type BranchSubject } from "@/lib/midTimetable/rules";
import { downloadMidTimetablePdf } from "@/lib/pdf/downloadMidTimetable";
import type { MidExamPlan, MidExamSession, MidExamSlot, MidTimetable } from "@/types";

// Exam Cell: one Mid's timetable as ONE sheet, like the printed one - branches
// down the side, exam days across the top. Click a cell to put that branch's
// subject(s) there (several = electives, with a heading); a subject several
// branches share can go on the same day for all of them at once. Auto-fill
// fills the empty days; Save draft / Publish all save every branch.

interface Branch { branch: string; key: string; subjects: BranchSubject[]; timetable: MidTimetable | null }
interface Data { plan: MidExamPlan; window: { from: string; to: string } | null; range: { from: string; to: string } | null; branches: Branch[] }
type Row = { subjectId: string; date: string; sessionId: string; group?: string };
type CellRef = { key: string; date: string; sessionId: string };

/** Every date of the range, Sundays included (they start unticked). */
function rangeDates(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 62) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

export default function MidTimetableBuilderPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = use(params);
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [edits, setEdits] = useState<Record<string, Row[]>>({}); // unsaved, per branch key
  const [days, setDays] = useState<string[]>([]);
  const [sessions, setSessions] = useState<MidExamSession[]>([]);
  const [setupDirty, setSetupDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [cell, setCell] = useState<CellRef | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [heading, setHeading] = useState("");
  const [everywhere, setEverywhere] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/college/mid-timetables/${encodeURIComponent(planId)}`)
      .then(async (r) => { const d = (await r.json()) as Data & { error?: string }; if (!r.ok) throw new Error(d.error ?? "Failed to load"); return d; })
      .then((d) => { setData(d); setDays(d.plan.days); setSessions(d.plan.sessions); setSetupDirty(false); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [planId]);
  useEffect(() => { load(); }, [load]);

  const dirty = setupDirty || Object.keys(edits).length > 0;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const rowsOf = useCallback((b: Branch): Row[] => edits[b.key] ?? b.subjects.map((s) => {
    const slot = b.timetable?.slots.find((x) => x.subjectId === s.subjectId);
    return { subjectId: s.subjectId, date: slot?.date ?? "", sessionId: slot?.sessionId ?? "", ...(slot?.group ? { group: slot.group } : {}) };
  }), [edits]);

  const plan = data?.plan;
  const slotsOf = useCallback((b: Branch): MidExamSlot[] => rowsOf(b).filter((r) => r.date && r.sessionId).map((r) => ({ ...b.subjects.find((s) => s.subjectId === r.subjectId)!, date: r.date, sessionId: r.sessionId, ...(r.group ? { group: r.group } : {}) })), [rowsOf]);
  const sheetRows = useMemo(() => (data?.branches ?? []).map((b) => {
    const slots = slotsOf(b);
    const missing = b.subjects.filter((s) => !slots.some((x) => x.subjectId === s.subjectId));
    const st = b.timetable?.status;
    return {
      key: b.key, branch: b.branch, slots,
      aside: (
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-normal">
          <span className={cn("rounded-full px-2 py-0.5 font-semibold", st === "PUBLISHED" ? "bg-emerald-100 text-emerald-800" : st === "DRAFT" ? "bg-amber-100 text-amber-900" : "bg-muted text-muted-foreground")}>
            {st === "PUBLISHED" ? "Published" : st === "DRAFT" ? "Draft" : "Not saved"}{edits[b.key] ? " · changed" : ""}
          </span>
          {missing.length > 0 && <span className="text-amber-700" title={missing.map((m) => m.subjectName).join(", ")}>{missing.length} not placed</span>}
          {st === "PUBLISHED" && <button type="button" className="text-muted-foreground underline hover:text-foreground" onClick={() => void unpublish(b)}>Unpublish</button>}
        </span>
      ),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- unpublish only reads state at click time
  }), [data, slotsOf, edits]);

  const branchOf = (key: string) => data?.branches.find((b) => b.key === key) ?? null;

  function openCell(key: string, date: string, sessionId: string) {
    const b = branchOf(key);
    if (!b) return;
    const here = rowsOf(b).filter((r) => r.date === date && r.sessionId === sessionId);
    setCell({ key, date, sessionId });
    setPicked(new Set(here.map((r) => r.subjectId)));
    setHeading(here.find((r) => r.group)?.group ?? "");
  }

  /** Put the picked subjects in the cell (moving them from wherever they were); optionally the same for every branch that has them. */
  function applyCell() {
    if (!cell || !data) return;
    const group = picked.size ? heading.trim() : "";
    const next: Record<string, Row[]> = {};
    const target = branchOf(cell.key)!;
    next[target.key] = rowsOf(target).map((r) => {
      if (picked.has(r.subjectId)) return { subjectId: r.subjectId, date: cell.date, sessionId: cell.sessionId, ...(group ? { group } : {}) };
      if (r.date === cell.date && r.sessionId === cell.sessionId) return { subjectId: r.subjectId, date: "", sessionId: "" };
      return r;
    });
    let others = 0;
    if (everywhere && picked.size) {
      for (const b of data.branches) {
        if (b.key === target.key) continue;
        const rows = rowsOf(b);
        let changed = false;
        const out = rows.map((r) => {
          if (!picked.has(r.subjectId) || r.date) return r; // only subjects not placed yet there
          changed = true;
          return { subjectId: r.subjectId, date: cell.date, sessionId: cell.sessionId, ...(group ? { group } : {}) };
        });
        if (changed) { next[b.key] = out; others++; }
      }
    }
    setEdits((e) => ({ ...e, ...next }));
    setCell(null);
    if (others) toast({ title: `Also placed in ${others} other branch${others === 1 ? "" : "es"}`, description: "Where those branches had the same subject not yet placed." });
  }

  function autoFillAll() {
    if (!data || !plan) return;
    const next: Record<string, Row[]> = {};
    const short: string[] = [];
    for (const b of data.branches) {
      const kept = slotsOf(b).filter((s) => plan.days.includes(s.date) && plan.sessions.some((x) => x.id === s.sessionId));
      const { slots, unplaced } = autoFill(b.subjects, kept, plan.days, plan.sessions);
      if (unplaced.length) short.push(`${b.branch}: ${unplaced.length}`);
      next[b.key] = b.subjects.map((s) => {
        const x = slots.find((y) => y.subjectId === s.subjectId);
        return { subjectId: s.subjectId, date: x?.date ?? "", sessionId: x?.sessionId ?? "", ...(x?.group ? { group: x.group } : {}) };
      });
    }
    setEdits(next);
    if (short.length) toast({ variant: "destructive", title: "Not enough exam days for some branches", description: `Not placed - ${short.join("; ")}. Add an exam day or a session, or put electives together in one cell.` });
    else toast({ title: "Every branch filled", description: "Check the sheet, move anything by clicking its cell, then Save draft or Publish all." });
  }

  async function put(b: Branch, action: "draft" | "publish" | "unpublish"): Promise<MidTimetable | string> {
    const res = await fetch(`/api/college/mid-timetables/${encodeURIComponent(planId)}/branches/${encodeURIComponent(b.key)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, slots: rowsOf(b), baseRev: b.timetable?.rev ?? 0 }),
    });
    const json = (await res.json()) as { error?: string; timetable?: MidTimetable };
    return res.ok && json.timetable ? json.timetable : json.error ?? "Could not save";
  }

  /** Save every changed branch - as a draft, or (publish) published when it is complete. */
  async function saveAll(publish: boolean) {
    if (!data || !plan) return;
    setBusy(publish ? "publish" : "draft");
    const saved: Record<string, MidTimetable> = {};
    const problems: string[] = [];
    try {
      for (const b of data.branches) {
        const isPub = b.timetable?.status === "PUBLISHED";
        const changed = Boolean(edits[b.key]);
        if (!publish && !changed) continue;
        if (publish && isPub && !changed) continue;
        const c = checkSlots(rowsOf(b), b.subjects, plan.days, plan.sessions);
        if (c.errors.length) { problems.push(`${b.branch}: ${c.errors[0]}`); continue; }
        // A published branch stays published when saved; it must stay complete.
        const action = publish || isPub ? "publish" : "draft";
        if (action === "publish" && !c.complete) { problems.push(`${b.branch}: ${b.subjects.length - c.slots.length} subject(s) not placed`); continue; }
        const r = await put(b, action);
        if (typeof r === "string") problems.push(`${b.branch}: ${r}`); else saved[b.key] = r;
      }
    } catch { problems.push("Network error - some branches were not saved"); }
    setData((d) => d && ({ ...d, branches: d.branches.map((x) => (saved[x.key] ? { ...x, timetable: saved[x.key] } : x)) }));
    setEdits((e) => { const n = { ...e }; for (const k of Object.keys(saved)) delete n[k]; return n; });
    const n = Object.keys(saved).length;
    if (problems.length) toast({ variant: "destructive", title: `${n} branch${n === 1 ? "" : "es"} saved; ${problems.length} not`, description: problems.join(" · ") });
    else toast({ variant: "success", title: n ? (publish ? `Published ${n} branch${n === 1 ? "" : "es"} - students, faculty and the Principal can see them` : `Saved ${n} branch${n === 1 ? "" : "es"} as drafts`) : "Nothing to save" });
    setBusy(null);
  }

  async function unpublish(b: Branch) {
    setBusy("unpublish");
    try {
      const r = await put(b, "unpublish");
      if (typeof r === "string") { toast({ variant: "destructive", title: r }); return; }
      setData((d) => d && ({ ...d, branches: d.branches.map((x) => (x.key === b.key ? { ...x, timetable: r } : x)) }));
      toast({ title: `${b.branch} is a draft again` });
    } catch { toast({ variant: "destructive", title: "Network error" }); }
    finally { setBusy(null); }
  }

  async function saveSetup() {
    setBusy("setup");
    try {
      const res = await fetch(`/api/college/mid-timetables/${encodeURIComponent(planId)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days, sessions }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Could not save" }); return; }
      toast({ variant: "success", title: "Exam days and time saved" });
      setEdits({});
      load();
    } catch { toast({ variant: "destructive", title: "Network error - nothing was saved" }); }
    finally { setBusy(null); }
  }

  async function removePlan() {
    const res = await fetch(`/api/college/mid-timetables/${encodeURIComponent(planId)}`, { method: "DELETE" });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Could not delete" }); setDeleting(false); return; }
    router.push("/exam-cell/mid-timetable");
  }

  if (error) return <div className="space-y-4"><Button asChild variant="ghost" size="sm"><Link href="/exam-cell/mid-timetable"><ArrowLeft className="mr-1.5 h-4 w-4" />Mid Timetable</Link></Button><p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</p></div>;
  if (!data || !plan) return <div className="space-y-4"><div className="h-10 w-72 animate-pulse rounded bg-muted" /><div className="h-96 animate-pulse rounded-2xl bg-muted" /></div>;

  const allDates = data.range ? rangeDates(data.range.from, data.range.to) : plan.days;
  const cellBranch = cell ? branchOf(cell.key) : null;
  const cellRows = cellBranch ? rowsOf(cellBranch) : [];
  const placed = data.branches.reduce((n, b) => n + slotsOf(b).length, 0);
  const total = data.branches.reduce((n, b) => n + b.subjects.length, 0);
  const published = data.branches.filter((b) => b.timetable?.status === "PUBLISHED").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Mid ${plan.midNumber} timetable`}
        description={`${plan.courseName} · ${ordinalYearLabel(plan.year)} · Semester ${plan.semester}${data.range ? ` · ${dayLabel(data.range.from)} - ${dayLabel(data.range.to)}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="ghost" size="sm"><Link href="/exam-cell/mid-timetable"><ArrowLeft className="mr-1.5 h-4 w-4" />Mid Timetable</Link></Button>
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleting(true)}><Trash2 className="mr-1.5 h-4 w-4" />Delete</Button>
          </div>
        }
      />

      {/* Step 1: days + time */}
      <Card className="rounded-2xl">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">1. Exam days and time</h2>
              <p className="text-sm text-muted-foreground">Tick the days exams are held (Sundays start off). One time for every exam, or add a second session for two exams a day.</p>
            </div>
            {setupDirty && <Button onClick={() => void saveSetup()} loading={busy === "setup"}><Check className="mr-1.5 h-4 w-4" />Save days &amp; time</Button>}
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Exam days">
            {allDates.map((d) => {
              const on = days.includes(d);
              const sunday = new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
              return (
                <button key={d} type="button" aria-pressed={on} onClick={() => { setDays((x) => (on ? x.filter((y) => y !== d) : [...x, d].sort())); setSetupDirty(true); }}
                  className={cn("rounded-xl border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background text-muted-foreground hover:border-primary/40", sunday && !on && "border-dashed")}>
                  <span className="block font-semibold">{dayLabel(d).split(" ")[0]}</span>
                  <span>{dayLabel(d).split(" ").slice(1, 3).join(" ")}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            {sessions.map((s, i) => (
              <div key={s.id} className="flex flex-wrap items-end gap-2 rounded-xl border bg-muted/20 p-2.5">
                {sessions.length > 1 && (
                  <div className="space-y-1"><Label htmlFor={`ses-${i}`} className="text-xs">Session</Label>
                    <Input id={`ses-${i}`} value={s.label} maxLength={40} className="h-9 w-32" onChange={(e) => { setSessions((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y))); setSetupDirty(true); }} /></div>
                )}
                <div className="space-y-1"><Label htmlFor={`ses-${i}-from`} className="text-xs">Time from</Label>
                  <Input id={`ses-${i}-from`} type="time" value={s.from} className="h-9 w-32" onChange={(e) => { setSessions((x) => x.map((y, j) => (j === i ? { ...y, from: e.target.value } : y))); setSetupDirty(true); }} /></div>
                <div className="space-y-1"><Label htmlFor={`ses-${i}-to`} className="text-xs">to</Label>
                  <Input id={`ses-${i}-to`} type="time" value={s.to} className="h-9 w-32" onChange={(e) => { setSessions((x) => x.map((y, j) => (j === i ? { ...y, to: e.target.value } : y))); setSetupDirty(true); }} /></div>
                {sessions.length > 1 && <Button variant="ghost" size="icon" aria-label={`Remove ${s.label}`} onClick={() => { setSessions((x) => x.filter((_, j) => j !== i)); setSetupDirty(true); }}><X className="h-4 w-4" /></Button>}
              </div>
            ))}
            {sessions.length < MAX_SESSIONS && (
              <Button variant="outline" size="sm" className="self-end" onClick={() => {
                const used = new Set(sessions.map((s) => s.id));
                const id = ["S1", "S2", "S3"].find((x) => !used.has(x)) ?? `S${sessions.length + 1}`;
                setSessions((x) => [...x.map((y, j) => (x.length === 1 && j === 0 && y.label === "Session 1" ? { ...y, label: "Morning" } : y)), { id, label: x.length === 1 ? "Afternoon" : `Session ${x.length + 1}`, from: "14:00", to: "15:30" }]);
                setSetupDirty(true);
              }}><Plus className="mr-1.5 h-4 w-4" />Add a second session a day</Button>
            )}
          </div>
          {setupDirty && <p className="text-xs text-amber-700">Save the days and time first - the sheet below uses the saved ones.</p>}
        </CardContent>
      </Card>

      {/* Step 2: the sheet */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">2. Timetable</h2>
            <p className="text-sm text-muted-foreground">Click a cell to put that branch&rsquo;s subject there. {placed} of {total} placed · {published} of {data.branches.length} branches published{plan.sessions.length === 1 ? ` · Time ${timeLabel(plan.sessions[0].from)} - ${timeLabel(plan.sessions[0].to)}` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={autoFillAll} disabled={setupDirty || data.branches.length === 0}><Sparkles className="mr-1.5 h-4 w-4" />Auto-fill all branches</Button>
            <Button variant="ghost" size="sm" disabled={setupDirty} onClick={() => setEdits(Object.fromEntries(data.branches.filter((b) => b.timetable?.status !== "PUBLISHED").map((b) => [b.key, b.subjects.map((s) => ({ subjectId: s.subjectId, date: "", sessionId: "" }))])))}><Eraser className="mr-1.5 h-4 w-4" />Clear drafts</Button>
            <Button variant="outline" size="sm" loading={busy === "pdf"} disabled={placed === 0}
              onClick={async () => {
                setBusy("pdf");
                try { await downloadMidTimetablePdf({ ...plan, rows: data.branches.map((b) => ({ branch: b.branch, slots: slotsOf(b) })) }, `mid${plan.midNumber}-${plan.courseName}-year${plan.year}-timetable`); }
                catch { toast({ variant: "destructive", title: "Could not make the PDF" }); }
                finally { setBusy(null); }
              }}><Download className="mr-1.5 h-4 w-4" />PDF</Button>
          </div>
        </div>

        {data.branches.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">No branch of this year has Theory subjects with teaching assignments in semester {plan.semester} yet.</p>
        ) : (
          <MidTimetableSheet rows={sheetRows} days={plan.days} sessions={plan.sessions} onCell={setupDirty ? undefined : openCell} cellTitle="Click to choose the subject" />
        )}

        <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-card/95 p-3 shadow-md backdrop-blur">
          <span className="text-xs text-muted-foreground">{Object.keys(edits).length ? `${Object.keys(edits).length} branch${Object.keys(edits).length === 1 ? "" : "es"} changed - not saved yet` : "All changes saved"}</span>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void saveAll(false)} loading={busy === "draft"} disabled={setupDirty || Object.keys(edits).length === 0}><Save className="mr-1.5 h-4 w-4" />Save draft</Button>
            <Button onClick={() => void saveAll(true)} loading={busy === "publish"} disabled={setupDirty || data.branches.length === 0}><Send className="mr-1.5 h-4 w-4" />Publish all</Button>
          </div>
        </div>
      </div>

      <Dialog open={cell !== null} onOpenChange={(o) => !o && setCell(null)}>
        <DialogContent className="sm:max-w-lg">
          {cell && cellBranch && (
            <>
              <DialogHeader>
                <DialogTitle>{cellBranch.branch}</DialogTitle>
                <DialogDescription>{dayLabel(cell.date)}{plan.sessions.length > 1 ? ` · ${plan.sessions.find((s) => s.id === cell.sessionId)?.label}` : ""} - tick the subject written then. Tick more than one for electives.</DialogDescription>
              </DialogHeader>
              <ul className="max-h-80 space-y-1.5 overflow-y-auto">
                {cellBranch.subjects.map((s) => {
                  const r = cellRows.find((x) => x.subjectId === s.subjectId);
                  const elsewhere = r?.date && !(r.date === cell.date && r.sessionId === cell.sessionId);
                  const on = picked.has(s.subjectId);
                  return (
                    <li key={s.subjectId}>
                      <label className={cn("flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-sm hover:bg-muted/50", on && "border-primary bg-primary/5")}>
                        <Checkbox checked={on} onCheckedChange={(v) => setPicked((p) => { const n = new Set(p); if (v === true) n.add(s.subjectId); else n.delete(s.subjectId); return n; })} />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{s.subjectName}</span> <span className="text-xs text-muted-foreground">({s.subjectCode})</span>
                          {elsewhere && <span className="block text-xs text-amber-700">Now on {dayLabel(r!.date)}{plan.sessions.length > 1 ? `, ${plan.sessions.find((x) => x.id === r!.sessionId)?.label}` : ""} - ticking moves it here</span>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {picked.size > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="cell-heading">Heading {picked.size > 1 ? "(for these electives)" : "(optional)"}</Label>
                  <Input id="cell-heading" value={heading} maxLength={60} placeholder="e.g. Professional Elective-IV" onChange={(e) => setHeading(e.target.value)} />
                </div>
              )}
              {data.branches.length > 1 && picked.size > 0 && (
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={everywhere} onCheckedChange={(v) => setEverywhere(v === true)} className="mt-0.5" />
                  <span>Same day for every branch that has {picked.size === 1 ? "this subject" : "these subjects"} <span className="block text-xs text-muted-foreground">Only where it isn&rsquo;t placed yet.</span></span>
                </label>
              )}
              <DialogFooter className="gap-2 sm:justify-between">
                <Button variant="ghost" onClick={() => setPicked(new Set())} disabled={picked.size === 0}><Eraser className="mr-1.5 h-4 w-4" />Empty this cell</Button>
                <Button onClick={applyCell}><Check className="mr-1.5 h-4 w-4" />Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting}
        onOpenChange={(o) => !o && setDeleting(false)}
        title="Delete this Mid timetable?"
        description="Every branch's draft is removed. Only possible while no branch is published."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void removePlan()}
      />
    </div>
  );
}
