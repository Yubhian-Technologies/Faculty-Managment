"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, CircleDashed, ClipboardCheck, Download, FileLock2, Lock, MessageSquareWarning, RotateCcw, Search, Send, Snowflake, Undo2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { cn, dmy, formatDateTime } from "@/lib/utils";
import { entryTotal, isComplete, runningTotal } from "@/lib/midMarks/sheet";
import { NOT_ATTEMPTED, type MidMarksEntry, type MidMarksSheet, type MidQuestionValue, type MidSheetCie } from "@/types/midMarks";
import type { QuestionSheet } from "@/lib/exams/questionMarks";

// One section's Mid marks (lib/midMarks). Faculty: a row per student in Regd. No order, a box per question of the
// printed paper ("-" = not attempted), AB for absent, the total worked out as you type, autosaved; Submit sends it to
// the Exam Cell (Withdraw takes it back until it is frozen); once FROZEN a change needs a request the Exam Cell
// approves. Exam Cell (review): Freeze, Reopen, decide change requests. When the paper had a CIE part (with-Mid
// unit), its marks are entered on Faculty > CIE Marks and only shown here (read only), with a link to enter them
// there while they are not complete.

export interface EntryState { canEdit: boolean; canWithdraw?: boolean; canRequestChange?: boolean; reason: string; lastDate: string | null }

type Row = { absent: boolean; q: Record<string, string> };
type Filter = "ALL" | "PENDING" | "DONE" | "ABSENT";
const toText = (v: MidQuestionValue | undefined) => (v === NOT_ATTEMPTED ? "-" : v == null ? "" : String(v));
const toValue = (t: string): MidQuestionValue | "BAD" => {
  const s = t.trim();
  if (!s) return null;
  if (s === "-") return NOT_ATTEMPTED;
  const n = Number(s);
  return Number.isFinite(n) ? n : "BAD";
};
const rowOf = (e: MidMarksEntry): Row => ({ absent: !!e.absent, q: Object.fromEntries(Object.entries(e.q).map(([k, v]) => [k, toText(v)])) });
const boxError = (text: string, max: number) => {
  const v = toValue(text);
  if (v === null || v === NOT_ATTEMPTED) return false;
  return v === "BAD" || v < 0 || v > max || !Number.isInteger(v * 2);
};
const asEntry = (sheet: QuestionSheet, r: Row): Pick<MidMarksEntry, "absent" | "q"> =>
  ({ absent: r.absent, q: Object.fromEntries(sheet.columns.map((c) => { const v = toValue(r.q[c.key] ?? ""); return [c.key, v === "BAD" ? null : v]; })) });
const jsonPatch = (url: string, body: unknown) => fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const STEPS = [
  { key: "DRAFT", label: "Entering", icon: CircleDashed },
  { key: "SUBMITTED", label: "With Exam Cell", icon: Send },
  { key: "FROZEN", label: "Frozen", icon: Snowflake },
] as const;

export function MidMarksSheetView({ initial, state: initialState, mode, cie = null, examCell = false }: {
  initial: MidMarksSheet; state: EntryState | null; mode: "faculty" | "review";
  /** Exam Cell: Freeze / Reopen / decide change requests. */
  examCell?: boolean;
  /** The with-Mid CIE unit as entered on CIE Marks (read only here). */
  cie?: MidSheetCie | null;
}) {
  const [sheet, setSheet] = useState(initial);
  const [state, setState] = useState(initialState);
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(initial.entries.map((e) => [e.studentId, rowOf(e)])));
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [dialog, setDialog] = useState<null | "SUBMIT" | "WITHDRAW" | "REQUEST" | "REOPEN" | "FREEZE" | "APPROVE" | "REJECT">(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const q = sheet.sheet;
  const editable = mode === "faculty" && sheet.status === "DRAFT" && !!state?.canEdit;
  const pending = sheet.changeRequest?.status === "PENDING";


  const rowFor = useCallback((e: MidMarksEntry) => rows[e.studentId] ?? rowOf(e), [rows]);
  const stats = useMemo(() => {
    let done = 0, absent = 0;
    const totals: number[] = [];
    for (const e of sheet.entries) {
      const r = rowFor(e);
      if (r.absent) { absent += 1; done += 1; continue; }
      const ent = asEntry(q, r);
      if (isComplete(q, ent)) { done += 1; const t = entryTotal(q, ent); if (t != null) totals.push(t); }
    }
    const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
    return { done, absent, pending: sheet.entries.length - done, avg, high: totals.length ? Math.max(...totals) : null };
  }, [sheet.entries, rowFor, q]);

  const shown = useMemo(() => {
    const f = find.trim().toUpperCase();
    return sheet.entries.filter((e) => {
      if (f && !e.rollNumber.toUpperCase().includes(f) && !e.name.toUpperCase().includes(f)) return false;
      const r = rowFor(e);
      const done = r.absent || isComplete(q, asEntry(q, r));
      return filter === "ALL" || (filter === "PENDING" && !done) || (filter === "DONE" && done && !r.absent) || (filter === "ABSENT" && r.absent);
    });
  }, [sheet.entries, find, filter, rowFor, q]);

  const setBox = (sid: string, key: string, text: string) => {
    setRows((p) => ({ ...p, [sid]: { ...p[sid], q: { ...p[sid].q, [key]: text } } }));
    setDirty((d) => new Set(d).add(sid));
  };
  const setAbsent = (sid: string, absent: boolean) => {
    setRows((p) => ({ ...p, [sid]: { absent, q: absent ? {} : p[sid].q } }));
    setDirty((d) => new Set(d).add(sid));
  };

  const take = (d: { sheet?: MidMarksSheet; state?: EntryState | null }) => { if (d.sheet) setSheet(d.sheet); if (d.state !== undefined) setState(d.state); };

  const save = useCallback(async (action?: "SUBMIT") => {
    const ids = [...dirty];
    if (!action && ids.length === 0) return true;
    for (const sid of ids) {
      const r = rows[sid];
      if (r.absent) continue;
      for (const c of q.columns) if (boxError(r.q[c.key] ?? "", c.max)) { toast({ variant: "destructive", title: `Fix ${sheet.entries.find((e) => e.studentId === sid)?.rollNumber ?? ""} ${c.label}: 0 to ${c.max}, or - for not attempted.` }); return false; }
    }
    setSaving(true);
    try {
      const entries = ids.map((sid) => {
        const r = rows[sid];
        return r.absent ? { studentId: sid, absent: true } : { studentId: sid, q: Object.fromEntries(q.columns.map((c) => { const v = toValue(r.q[c.key] ?? ""); return [c.key, v === "BAD" ? null : v]; })) };
      });
      const res = await jsonPatch(`/api/college/mid-marks-sheets/${sheet.id}`, { rev: sheet.rev, ...(entries.length ? { entries } : {}), ...(action ? { action } : {}) });
      const d = (await res.json()) as { sheet?: MidMarksSheet; state?: EntryState; error?: string };
      if (!res.ok || !d.sheet) throw new Error(d.error ?? "Unable to save the marks.");
      take(d);
      setDirty((cur) => { const n = new Set(cur); ids.forEach((i) => n.delete(i)); return n; });
      setSavedAt(new Date().toISOString());
      if (action === "SUBMIT") toast({ variant: "success", title: "Mid marks submitted to the Exam Cell." });
      return true;
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save the marks." });
      return false;
    } finally {
      setSaving(false);
    }
  }, [dirty, rows, q, sheet]);

  // Autosave a draft 2 s after the last change.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!editable || dirty.size === 0 || saving) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, 2000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [dirty, editable, saving, save]);

  // Enter / arrow keys move between boxes: data-r = row index, data-c = column index.
  const move = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const r = Number(el.dataset.r), c = Number(el.dataset.c);
    const go = (rr: number, cc: number) => { const t = document.querySelector<HTMLInputElement>(`input[data-r="${rr}"][data-c="${cc}"]`); if (t) { e.preventDefault(); t.focus(); t.select(); } };
    if (e.key === "Enter" || e.key === "ArrowDown") go(r + 1, c);
    else if (e.key === "ArrowUp") go(r - 1, c);
    else if (e.key === "ArrowRight" && el.selectionStart === el.value.length) go(r, c + 1);
    else if (e.key === "ArrowLeft" && el.selectionStart === 0) go(r, c - 1);
  };

  /** A sheet action other than save / submit (withdraw, request, freeze, reopen, decide). */
  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      const res = await jsonPatch(`/api/college/mid-marks-sheets/${sheet.id}`, { rev: sheet.rev, ...body });
      const d = (await res.json()) as { sheet?: MidMarksSheet; state?: EntryState | null; error?: string };
      if (!res.ok || !d.sheet) throw new Error(d.error ?? "Unable to complete the request.");
      take(d); setDialog(null); setNote("");
      toast({ variant: "success", title: done });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to complete the request." });
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (stats.pending > 0) { setDialog(null); toast({ variant: "destructive", title: `${stats.pending} student(s) are not complete. Fill every box (a mark, or - for not attempted) or mark the student AB.` }); return; }
    setBusy(true);
    await save("SUBMIT");
    setBusy(false); setDialog(null);
  };

  const exportCsv = () => {
    const head = ["Regd. No", "Name", ...q.columns.map((c, i) => `${colLabel(i, c.label)} (${c.max})`), `Total (${q.paperMax})`, ...(cie ? [`CIE Unit ${cie.unit}${cie.unitMarks != null ? ` (${cie.unitMarks})` : ""}`] : [])];
    const lines = sheet.entries.map((e) => {
      const r = rowFor(e);
      const t = entryTotal(q, asEntry(q, r));
      return [e.rollNumber, e.name, ...q.columns.map((c) => (r.absent ? "AB" : r.q[c.key] ?? "")), r.absent ? "AB" : t ?? "", ...(cie ? [cie.marks[e.studentId] ?? ""] : [])];
    });
    const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `Mid-${sheet.midNumber}_${sheet.subjectCode ?? sheet.subjectName}_${sheet.sectionName}.csv`.replace(/\s+/g, "_");
    a.click();
  };

  // One part (VIT): questions read Q1..Q5; several parts keep the part's own labels.
  const colLabel = (i: number, label: string) => (q.parts.length === 1 ? `Q${i + 1}` : label);
  const pairStart = new Set<string>();
  for (const p of q.parts) if (p.choice.kind === "OR_PAIRS") q.columns.filter((c) => c.partId === p.id).forEach((c, i) => { if (i % 2 === 1) pairStart.add(c.key); });
  const partsLine = q.parts.map((p) => `${p.label} · ${p.questions} question${p.questions === 1 ? "" : "s"}${p.choice.kind === "OR_PAIRS" ? " (OR pairs)" : p.choice.kind === "ANY" ? ` (any ${p.choice.answer})` : ""}`).join("  ·  ");
  const pct = sheet.entries.length ? Math.round((stats.done / sheet.entries.length) * 100) : 0;
  const stepIndex = STEPS.findIndex((s) => s.key === sheet.status);
  const last = sheet.history?.slice(-1)[0];

  // What the banner under the header says, by where the sheet stands.
  const banner = (() => {
    if (pending) return { tone: "amber", icon: MessageSquareWarning, title: "Change request waiting for the Exam Cell", text: `${sheet.changeRequest!.byName}: ${sheet.changeRequest!.reason}` };
    if (sheet.changeRequest?.status === "REJECTED" && sheet.status !== "DRAFT") return { tone: "red", icon: MessageSquareWarning, title: "Change request rejected", text: sheet.changeRequest.remarks ?? "" };
    if (sheet.status === "FROZEN") return { tone: "slate", icon: Lock, title: `Frozen by ${sheet.frozenByName ?? "the Exam Cell"}${sheet.frozenAt ? ` on ${formatDateTime(new Date(sheet.frozenAt))}` : ""}`, text: mode === "faculty" ? "These marks are final. To change them, send a change request to the Exam Cell." : "Final. The faculty can only change them through a change request." };
    if (sheet.status === "SUBMITTED") return { tone: "blue", icon: Send, title: `Submitted to the Exam Cell${sheet.submittedAt ? ` on ${formatDateTime(new Date(sheet.submittedAt))}` : ""}`, text: mode === "faculty" ? "You can withdraw it to make changes until the Exam Cell freezes it." : "Check the marks and freeze them, or reopen them for the faculty." };
    if (sheet.editGrant && mode === "faculty") return { tone: "blue", icon: RotateCcw, title: "Reopened by the Exam Cell", text: "Make the changes and submit again." };
    if (mode === "faculty" && !editable && state?.reason) return { tone: "amber", icon: FileLock2, title: "Not open for entry", text: state.reason };
    return null;
  })();
  const TONES: Record<string, string> = {
    amber: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
    red: "border-red-300 bg-red-50 text-red-950 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100",
    slate: "border-slate-300 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100",
    blue: "border-blue-300 bg-blue-50 text-blue-950 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100",
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">Mid-{sheet.midNumber}</span>
                {sheet.subjectCode && <span className="rounded-md border bg-background/70 px-2 py-0.5 font-mono text-xs text-muted-foreground">{sheet.subjectCode}</span>}
              </div>
              <h1 className="text-xl font-semibold leading-tight">{sheet.subjectName}</h1>
              <p className="text-sm text-muted-foreground">{sheet.department} · Section {sheet.sectionName}{sheet.year ? ` · Year ${sheet.year}` : ""} · {sheet.facultyName}</p>
              <p className="text-xs text-muted-foreground">Paper: {partsLine} · out of {q.paperMax}{cie?.unitMarks != null ? ` · CIE Unit ${cie.unit} out of ${cie.unitMarks}` : ""}{state?.lastDate ? ` · last date ${dmy(state.lastDate)}` : ""}</p>
            </div>
            {/* Where it stands */}
            <ol className="flex items-center gap-1" aria-label="Status">
              {STEPS.map((s, i) => {
                const reached = i <= stepIndex;
                const Icon = i < stepIndex ? CheckCircle2 : s.icon;
                return (
                  <li key={s.key} className="flex items-center gap-1">
                    {i > 0 && <span className={cn("h-0.5 w-6 rounded", reached ? "bg-primary" : "bg-border")} />}
                    <span className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                      i === stepIndex ? "border-primary bg-primary text-primary-foreground" : reached ? "border-primary/40 bg-primary/10 text-primary" : "bg-background text-muted-foreground")}>
                      <Icon className="h-3.5 w-3.5" />{s.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {/* Numbers */}
        <div className="grid grid-cols-2 gap-px border-t bg-border sm:grid-cols-5">
          <div className="col-span-2 bg-card p-4 sm:col-span-1">
            <p className="text-xs text-muted-foreground">Complete</p>
            <p className="text-2xl font-semibold tabular-nums">{stats.done}<span className="text-base font-normal text-muted-foreground"> / {sheet.entries.length}</span></p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
          </div>
          <Stat label="Pending" value={stats.pending} />
          <Stat label="Absent" value={stats.absent} />
          <Stat label="Class Average" value={stats.avg == null ? "-" : stats.avg.toFixed(1)} sub={`of ${q.paperMax}`} />
          <Stat label="Highest" value={stats.high ?? "-"} sub={`of ${q.paperMax}`} />
        </div>
      </Card>

      {banner && (
        <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", TONES[banner.tone])}>
          <banner.icon className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{banner.title}</p>
            {banner.text && <p className="text-sm opacity-90">{banner.text}</p>}
          </div>
        </div>
      )}

      {/* With-Mid CIE: entered on CIE Marks, shown here */}
      {cie && (() => {
        const done = cie.total > 0 && cie.entered === cie.total;
        const href = `/panel/cea?assignment=${encodeURIComponent(sheet.assignmentId)}&unit=${cie.unit}`;
        return (
          <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm",
            done ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200")}>
            <div className="flex min-w-0 items-start gap-2">
              <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">CIE Unit {cie.unit} (written with Mid-{sheet.midNumber})</p>
                <p className="text-xs opacity-90">
                  {cie.status === "NOT_STARTED" ? "Not entered yet. CIE marks are entered on CIE Marks and appear here."
                    : done ? `All ${cie.total} students entered on CIE Marks${cie.status === "SUBMITTED" ? " and submitted" : " (draft - submit it on CIE Marks)"}.`
                    : `${cie.entered} of ${cie.total} students entered on CIE Marks. Enter the rest there.`}
                </p>
              </div>
            </div>
            {mode === "faculty" && (cie.status !== "SUBMITTED" || !done) && (
              <Button asChild size="sm" variant={done ? "outline" : "default"}>
                <Link href={href}>{cie.status === "NOT_STARTED" ? "Enter on CIE Marks" : done ? "Open CIE Marks" : "Continue on CIE Marks"}<ArrowRight className="h-3.5 w-3.5" /></Link>
              </Button>
            )}
          </div>
        );
      })()}

      {/* Toolbar */}
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
        <div className="relative w-44">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Find Regd. No" value={find} onChange={(e) => setFind(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1">
          {([["ALL", `All ${sheet.entries.length}`], ["PENDING", `Pending ${stats.pending}`], ["DONE", "Complete"], ["ABSENT", `Absent ${stats.absent}`]] as [Filter, string][]).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setFilter(k)}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", filter === k ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary")}>{l}</button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {editable && <span className="text-xs text-muted-foreground">{saving ? "Saving..." : dirty.size ? "Unsaved changes" : savedAt ? `Saved ${formatDateTime(new Date(savedAt))}` : "All changes saved"}</span>}
          <Button variant="ghost" size="sm" onClick={exportCsv}><Download className="mr-1 h-4 w-4" />CSV</Button>
          {editable && <Button variant="outline" size="sm" disabled={saving || dirty.size === 0} onClick={() => void save()}>Save</Button>}
          {editable && <Button size="sm" disabled={saving} onClick={() => setDialog("SUBMIT")}><Send className="mr-1 h-4 w-4" />Submit to Exam Cell</Button>}
          {mode === "faculty" && state?.canWithdraw && <Button size="sm" variant="outline" onClick={() => setDialog("WITHDRAW")}><Undo2 className="mr-1 h-4 w-4" />Withdraw</Button>}
          {mode === "faculty" && state?.canRequestChange && <Button size="sm" variant="outline" onClick={() => setDialog("REQUEST")}><MessageSquareWarning className="mr-1 h-4 w-4" />Request Change</Button>}
          {examCell && pending && <>
            <Button size="sm" onClick={() => setDialog("APPROVE")}>Approve Request</Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("REJECT")}>Reject Request</Button>
          </>}
          {examCell && sheet.status === "SUBMITTED" && <Button size="sm" onClick={() => setDialog("FREEZE")}><Snowflake className="mr-1 h-4 w-4" />Freeze</Button>}
          {examCell && sheet.status !== "DRAFT" && !pending && <Button size="sm" variant="outline" onClick={() => setDialog("REOPEN")}><RotateCcw className="mr-1 h-4 w-4" />Reopen</Button>}
        </div>
      </div>
      {editable && <p className="px-1 text-xs text-muted-foreground">Type a mark in each box, or <kbd className="rounded border bg-muted px-1">-</kbd> if the question was not attempted. Tap AB for an absent student. <kbd className="rounded border bg-muted px-1">Enter</kbd> and the arrow keys move between boxes; marks save on their own.</p>}

      {/* Sheet */}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="w-10 px-3 py-2.5 text-left font-medium">#</th>
              <th className="px-3 py-2.5 text-left font-medium">Student</th>
              {q.columns.map((c, i) => (
                <th key={c.key} className={cn("px-1 py-2.5 text-center font-medium", pairStart.has(c.key) && "border-l border-dashed")}>
                  <span className="block font-semibold text-foreground">{colLabel(i, c.label)}</span>
                  <span className="text-[10px]">{pairStart.has(c.key) ? "or · " : ""}/{c.max}</span>
                </th>
              ))}
              <th className="px-2 py-2.5 text-center font-medium">AB</th>
              <th className="px-3 py-2.5 text-right font-medium"><span className="block font-semibold text-foreground">Total</span><span className="text-[10px]">/{q.paperMax}</span></th>
              {cie && <th className="border-l px-2 py-2.5 text-center font-medium"><span className="block font-semibold text-foreground">CIE U{cie.unit}</span><span className="text-[10px]">{cie.unitMarks != null ? `/${cie.unitMarks}` : "CIE Marks"}</span></th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((e, ri) => {
              const r = rowFor(e);
              const ent = asEntry(q, r);
              const done = r.absent || isComplete(q, ent);
              const total = r.absent ? 0 : runningTotal(q, ent);
              const share = q.paperMax ? Math.min(100, (total / q.paperMax) * 100) : 0;
              const index = sheet.entries.indexOf(e) + 1;
              return (
                <tr key={e.studentId} className={cn("border-b last:border-b-0 transition-colors hover:bg-muted/30", r.absent && "bg-muted/40", !done && editable && "bg-amber-50/50 dark:bg-amber-950/10")}>
                  <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">{index}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", r.absent ? "bg-muted-foreground/50" : done ? "bg-emerald-500" : "bg-amber-400")} aria-hidden />
                      <div className="min-w-0">
                        <p className="font-medium tabular-nums">{e.rollNumber || "-"}</p>
                        <p className="max-w-[220px] truncate text-xs text-muted-foreground">{e.name}</p>
                      </div>
                    </div>
                  </td>
                  {q.columns.map((c, ci) => {
                    const t = r.q[c.key] ?? "";
                    const bad = boxError(t, c.max);
                    return (
                      <td key={c.key} className={cn("px-1 py-2 text-center", pairStart.has(c.key) && "border-l border-dashed")}>
                        <input
                          data-r={ri} data-c={ci} inputMode="decimal" disabled={!editable || r.absent} value={r.absent ? "" : t} placeholder={r.absent ? "AB" : ""}
                          onChange={(ev) => setBox(e.studentId, c.key, ev.target.value)} onKeyDown={move} onFocus={(ev) => ev.currentTarget.select()}
                          aria-label={`${e.rollNumber} ${colLabel(ci, c.label)}`} aria-invalid={bad}
                          className={cn("h-9 w-12 rounded-lg border bg-background text-center text-sm tabular-nums outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:bg-transparent disabled:border-transparent",
                            t === "-" && "text-muted-foreground", t && t !== "-" && !bad && "border-primary/30 bg-primary/5 font-medium",
                            bad && "border-destructive bg-destructive/5 ring-2 ring-destructive/30")}
                        />
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 text-center">
                    <button type="button" disabled={!editable} onClick={() => setAbsent(e.studentId, !r.absent)} aria-pressed={r.absent} aria-label={`${e.rollNumber} absent`}
                      className={cn("h-8 rounded-full border px-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed",
                        r.absent ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:border-foreground disabled:opacity-40")}>AB</button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.absent ? <span className="text-xs font-semibold text-muted-foreground">Absent</span> : (
                      <div className="ml-auto w-20">
                        <p className={cn("text-base font-semibold tabular-nums", !done && "text-muted-foreground")}>{total}</p>
                        <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary/70" style={{ width: `${share}%` }} /></div>
                      </div>
                    )}
                  </td>
                  {cie && (
                    <td className="border-l px-2 py-2 text-center tabular-nums">
                      {cie.marks[e.studentId] == null ? <span className="text-xs text-muted-foreground">-</span>
                        : cie.marks[e.studentId] === "AB" ? <span className="text-xs font-semibold text-muted-foreground">AB</span>
                        : <span className="font-medium">{cie.marks[e.studentId]}</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
            <Users className="h-6 w-6" />{filter === "PENDING" ? "Every student is complete." : "No students match."}
          </div>
        )}
      </Card>

      {last && <p className="px-1 text-xs text-muted-foreground">Last step: {HISTORY[last.action] ?? last.action} by {last.byName} on {formatDateTime(new Date(last.at))}{last.reason ? ` - ${last.reason}` : ""}</p>}

      {/* Dialogs */}
      <Dialog open={!!dialog} onOpenChange={(o) => { if (!o) { setDialog(null); setNote(""); } }}>
        <DialogContent>
          {dialog === "SUBMIT" && <>
            <DialogHeader>
              <DialogTitle>Submit to Exam Cell</DialogTitle>
              <DialogDescription>{sheet.subjectName}, {sheet.sectionName}: {stats.done} of {sheet.entries.length} students complete. You can withdraw it until the Exam Cell freezes it; after that a change needs a request.</DialogDescription>
            </DialogHeader>
            <DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button><Button loading={busy} onClick={() => void submit()}>Submit</Button></DialogFooter>
          </>}
          {dialog === "WITHDRAW" && <>
            <DialogHeader>
              <DialogTitle>Withdraw Submission</DialogTitle>
              <DialogDescription>The marks come back to you as a draft so you can change them. Submit again when done.</DialogDescription>
            </DialogHeader>
            <DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button><Button loading={busy} onClick={() => void act({ action: "WITHDRAW" }, "Submission withdrawn.")}>Withdraw</Button></DialogFooter>
          </>}
          {(dialog === "REQUEST" || dialog === "REOPEN" || dialog === "REJECT" || dialog === "APPROVE") && <>
            <DialogHeader>
              <DialogTitle>{dialog === "REQUEST" ? "Request a Change" : dialog === "REOPEN" ? "Reopen for the Faculty" : dialog === "APPROVE" ? "Approve Change Request" : "Reject Change Request"}</DialogTitle>
              <DialogDescription>
                {dialog === "REQUEST" ? "Tell the Exam Cell which marks need to change and why. Once they approve, the sheet opens for you again."
                  : dialog === "REOPEN" ? "The faculty member can change the marks again (even after the last date) and must submit them again. They are told the reason."
                  : dialog === "APPROVE" ? `${sheet.changeRequest?.byName}: "${sheet.changeRequest?.reason}". Approving opens the sheet for them again.`
                  : `${sheet.changeRequest?.byName}: "${sheet.changeRequest?.reason}". The marks stay as they are.`}
              </DialogDescription>
            </DialogHeader>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={dialog === "REQUEST" ? "For example: 26PA1A0507 Q3 entered as 2, should be 4" : dialog === "APPROVE" ? "Remarks (optional)" : "Reason"} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
              <Button loading={busy} disabled={dialog !== "APPROVE" && !note.trim()} onClick={() => void act(
                dialog === "REQUEST" ? { action: "REQUEST_CHANGE", reason: note } : dialog === "REOPEN" ? { action: "REOPEN", reason: note } : { action: "DECIDE", approve: dialog === "APPROVE", remarks: note },
                dialog === "REQUEST" ? "Change request sent to the Exam Cell." : dialog === "REOPEN" ? "Sheet reopened. The faculty member was told." : dialog === "APPROVE" ? "Request approved. The sheet is open for the faculty member." : "Request rejected. The faculty member was told.",
              )}>{dialog === "REQUEST" ? "Send Request" : dialog === "REOPEN" ? "Reopen" : dialog === "APPROVE" ? "Approve" : "Reject"}</Button>
            </DialogFooter>
          </>}
          {dialog === "FREEZE" && <>
            <DialogHeader>
              <DialogTitle>Freeze Marks</DialogTitle>
              <DialogDescription>The marks become final. The faculty member can only change them through a change request you approve.</DialogDescription>
            </DialogHeader>
            <DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button><Button loading={busy} onClick={() => void act({ action: "FREEZE" }, "Marks frozen.")}>Freeze</Button></DialogFooter>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const HISTORY: Record<string, string> = {
  SUBMITTED: "Submitted", WITHDRAWN: "Withdrawn", FROZEN: "Frozen", REOPENED: "Reopened",
  CHANGE_REQUESTED: "Change requested", CHANGE_APPROVED: "Change approved", CHANGE_REJECTED: "Change rejected",
};

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}{sub && <span className="ml-1 text-sm font-normal text-muted-foreground">{sub}</span>}</p>
    </div>
  );
}
