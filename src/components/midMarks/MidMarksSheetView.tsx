"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { cn, dmy, formatDateTime } from "@/lib/utils";
import { entryTotal, isComplete, runningTotal } from "@/lib/midMarks/sheet";
import { NOT_ATTEMPTED, type MidMarksEntry, type MidMarksSheet, type MidQuestionValue } from "@/types/midMarks";
import type { QuestionSheet } from "@/lib/exams/questionMarks";

// One section's Mid marks (lib/midMarks): a row per student in Regd. No order, a box per question of the printed
// paper ("-" = not attempted), AB for absent, the total worked out as you type. Faculty: autosaves a draft, Submit
// locks it. Exam Cell / HOD (review): read only; the Exam Cell can reopen a submitted sheet with a reason.
// When the paper had a CIE part (with-Mid unit), its total is entered here too, into the CIE marks sheet.

export interface EntryState { canEdit: boolean; reason: string; lastDate: string | null }
interface CieSheet { id: string; rev: number; status: "DRAFT" | "SUBMITTED"; unitMarks: number; unit: number; entries: { studentId: string; marks: number | null; absent?: boolean }[] }

type Row = { absent: boolean; q: Record<string, string> };
const toText = (v: MidQuestionValue | undefined) => (v === NOT_ATTEMPTED ? "-" : v == null ? "" : String(v));
const toValue = (t: string): MidQuestionValue | "BAD" => {
  const s = t.trim();
  if (!s) return null;
  if (s === "-") return NOT_ATTEMPTED;
  const n = Number(s);
  return Number.isFinite(n) ? n : "BAD";
};
const rowOf = (e: MidMarksEntry): Row => ({ absent: !!e.absent, q: Object.fromEntries(Object.entries(e.q).map(([k, v]) => [k, toText(v)])) });

function boxError(text: string, max: number): boolean {
  const v = toValue(text);
  if (v === null || v === NOT_ATTEMPTED) return false;
  return v === "BAD" || v < 0 || v > max || !Number.isInteger(v * 2);
}

function asEntry(sheet: QuestionSheet, r: Row): Pick<MidMarksEntry, "absent" | "q"> {
  return { absent: r.absent, q: Object.fromEntries(sheet.columns.map((c) => { const v = toValue(r.q[c.key] ?? ""); return [c.key, v === "BAD" ? null : v]; })) };
}

export function MidMarksSheetView({ initial, state, mode, cieAssignment, canReopen = false }: {
  initial: MidMarksSheet; state: EntryState | null; mode: "faculty" | "review";
  /** Exam Cell: may reopen a submitted sheet. */
  canReopen?: boolean;
  /** Faculty: the assignment, to find the CIE unit planned with this Mid. */
  cieAssignment?: string;
}) {
  const [sheet, setSheet] = useState(initial);
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(initial.entries.map((e) => [e.studentId, rowOf(e)])));
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [reopen, setReopen] = useState(false);
  const [reason, setReason] = useState("");
  const [cie, setCie] = useState<CieSheet | null>(null);
  const [cieText, setCieText] = useState<Record<string, string>>({});
  const [cieDirty, setCieDirty] = useState<Set<string>>(new Set());
  const q = sheet.sheet;
  const editable = mode === "faculty" && sheet.status === "DRAFT" && !!state?.canEdit;
  const cieEditable = editable && cie?.status === "DRAFT";

  // CIE unit written with this Mid (the paper's CIE part): one total per student, kept in the CIE marks sheet.
  useEffect(() => {
    if (mode !== "faculty" || !cieAssignment) return;
    (async () => {
      const list = await fetch("/api/college/cea/marks").then((r) => (r.ok ? r.json() : { assignments: [] })) as { assignments?: { assignmentId: string; units: { unit: number; when: string }[] }[] };
      const unit = list.assignments?.find((a) => a.assignmentId === cieAssignment)?.units.find((u) => u.when === `MID${sheet.midNumber}`)?.unit;
      if (!unit) return;
      const res = await fetch("/api/college/cea/marks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignmentId: cieAssignment, unit }) });
      if (!res.ok) return;
      const d = (await res.json()) as { sheet: CieSheet };
      setCie(d.sheet);
      setCieText(Object.fromEntries(d.sheet.entries.map((e) => [e.studentId, e.absent ? "AB" : e.marks == null ? "" : String(e.marks)])));
    })().catch(() => undefined);
  }, [mode, cieAssignment, sheet.midNumber]);

  const complete = useMemo(() => sheet.entries.filter((e) => isComplete(q, asEntry(q, rows[e.studentId] ?? rowOf(e)))).length, [sheet.entries, rows, q]);
  const shown = useMemo(() => {
    const f = find.trim().toUpperCase();
    return sheet.entries.filter((e) => {
      if (f && !e.rollNumber.toUpperCase().includes(f) && !e.name.toUpperCase().includes(f)) return false;
      if (pendingOnly && isComplete(q, asEntry(q, rows[e.studentId] ?? rowOf(e)))) return false;
      return true;
    });
  }, [sheet.entries, find, pendingOnly, rows, q]);

  const setBox = (sid: string, key: string, text: string) => {
    setRows((p) => ({ ...p, [sid]: { ...p[sid], q: { ...p[sid].q, [key]: text } } }));
    setDirty((d) => new Set(d).add(sid));
  };
  const setAbsent = (sid: string, absent: boolean) => {
    setRows((p) => ({ ...p, [sid]: { absent, q: absent ? {} : p[sid].q } }));
    setDirty((d) => new Set(d).add(sid));
    if (cie) { setCieText((p) => ({ ...p, [sid]: absent ? "AB" : p[sid] === "AB" ? "" : p[sid] ?? "" })); setCieDirty((d) => new Set(d).add(sid)); }
  };

  const save = useCallback(async (action?: "SUBMIT") => {
    const ids = [...dirty];
    const cieIds = [...cieDirty];
    if (!action && ids.length === 0 && cieIds.length === 0) return true;
    for (const sid of ids) {
      const r = rows[sid];
      if (r.absent) continue;
      for (const c of q.columns) if (boxError(r.q[c.key] ?? "", c.max)) { toast({ variant: "destructive", title: `Fix ${sheet.entries.find((e) => e.studentId === sid)?.rollNumber ?? ""} ${c.label}: 0 to ${c.max}, or - for not attempted.` }); return false; }
    }
    setSaving(true);
    try {
      if (cie && cieIds.length && cie.status === "DRAFT") {
        const entries = cieIds.map((sid) => {
          const t = (cieText[sid] ?? "").trim().toUpperCase();
          return t === "AB" ? { studentId: sid, absent: true } : { studentId: sid, marks: t === "" ? null : Number(t) };
        });
        const res = await fetch(`/api/college/cea/marks/${cie.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev: cie.rev, entries, ...(action ? { action } : {}) }) });
        const d = (await res.json()) as { sheet?: CieSheet; error?: string };
        if (!res.ok || !d.sheet) throw new Error(`CIE: ${d.error ?? "Unable to save the CIE marks."}`);
        setCie(d.sheet); setCieDirty(new Set());
      }
      const entries = ids.map((sid) => {
        const r = rows[sid];
        return r.absent ? { studentId: sid, absent: true } : { studentId: sid, q: Object.fromEntries(q.columns.map((c) => { const v = toValue(r.q[c.key] ?? ""); return [c.key, v === "BAD" ? null : v]; })) };
      });
      const res = await fetch(`/api/college/mid-marks-sheets/${sheet.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rev: sheet.rev, ...(entries.length ? { entries } : {}), ...(action ? { action } : {}) }),
      });
      const d = (await res.json()) as { sheet?: MidMarksSheet; error?: string };
      if (!res.ok || !d.sheet) throw new Error(d.error ?? "Unable to save the marks.");
      setSheet(d.sheet);
      setDirty((cur) => { const n = new Set(cur); ids.forEach((i) => n.delete(i)); return n; });
      setSavedAt(new Date().toISOString());
      if (action === "SUBMIT") {
        if (cie && cie.status === "DRAFT" && cieIds.length === 0) {
          const r2 = await fetch(`/api/college/cea/marks/${cie.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev: cie.rev, action: "SUBMIT" }) });
          const d2 = (await r2.json()) as { sheet?: CieSheet; error?: string };
          if (r2.ok && d2.sheet) setCie(d2.sheet); else toast({ variant: "destructive", title: `Mid marks submitted. CIE: ${d2.error ?? "not submitted."}` });
        }
        toast({ variant: "success", title: "Mid marks submitted." });
      }
      return true;
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save the marks." });
      return false;
    } finally {
      setSaving(false);
    }
  }, [dirty, cieDirty, rows, cieText, cie, q, sheet]);

  // Autosave a draft 2 s after the last change.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!editable || (dirty.size === 0 && cieDirty.size === 0) || saving) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, 2000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [dirty, cieDirty, editable, saving, save]);

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

  const submit = async () => {
    setConfirmSubmit(false);
    if (complete < sheet.entries.length) { toast({ variant: "destructive", title: `${sheet.entries.length - complete} student(s) are not complete. Fill every box (a mark, or - for not attempted) or mark the student AB.` }); return; }
    await save("SUBMIT");
  };

  const doReopen = async () => {
    const res = await fetch(`/api/college/mid-marks-sheets/${sheet.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev: sheet.rev, action: "REOPEN", reason }) });
    const d = (await res.json()) as { sheet?: MidMarksSheet; error?: string };
    if (!res.ok || !d.sheet) { toast({ variant: "destructive", title: d.error ?? "Unable to reopen the sheet." }); return; }
    setSheet(d.sheet); setReopen(false); setReason("");
    toast({ variant: "success", title: "Sheet reopened. The faculty member was told." });
  };

  const exportCsv = () => {
    const head = ["Regd. No", "Name", ...q.columns.map((c) => `${c.label} (${c.max})`), `Total (${q.paperMax})`, ...(cie ? [`CIE Unit ${cie.unit} (${cie.unitMarks})`] : [])];
    const lines = sheet.entries.map((e) => {
      const r = rows[e.studentId] ?? rowOf(e);
      const t = entryTotal(q, asEntry(q, r));
      return [e.rollNumber, e.name, ...q.columns.map((c) => (r.absent ? "AB" : r.q[c.key] ?? "")), r.absent ? "AB" : t ?? "", ...(cie ? [cieText[e.studentId] ?? ""] : [])];
    });
    const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `Mid-${sheet.midNumber}_${sheet.subjectCode ?? sheet.subjectName}_${sheet.sectionName}.csv`.replace(/\s+/g, "_");
    a.click();
  };

  // OR pairs: questions shown in their pairs ("Q1 or Q2") so the better of the two is counted.
  const pairStart = new Set<string>();
  for (const p of q.parts) if (p.choice.kind === "OR_PAIRS") q.columns.filter((c) => c.partId === p.id).forEach((c, i) => { if (i % 2 === 1) pairStart.add(c.key); });
  const partsLine = q.parts.map((p) => `${p.label}: ${p.questions} question${p.questions === 1 ? "" : "s"}${p.choice.kind === "OR_PAIRS" ? " (OR pairs)" : p.choice.kind === "ANY" ? ` (any ${p.choice.answer})` : ""}`).join(" · ");
  const pct = sheet.entries.length ? Math.round((complete / sheet.entries.length) * 100) : 0;

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold">{sheet.subjectName}</h1>
              {sheet.subjectCode && <span className="text-sm text-muted-foreground">{sheet.subjectCode}</span>}
              <Badge>Mid-{sheet.midNumber}</Badge>
              <Badge variant={sheet.status === "SUBMITTED" ? "default" : "secondary"}>{sheet.status === "SUBMITTED" ? "Submitted" : "Draft"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{sheet.department} · {sheet.sectionName}{sheet.year ? ` · Year ${sheet.year}` : ""} · {sheet.facultyName}</p>
            <p className="mt-1 text-xs text-muted-foreground">Question paper · {partsLine} · out of {q.paperMax}{cie ? ` · CIE Unit ${cie.unit} out of ${cie.unitMarks}` : ""}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {state?.lastDate && <span className="text-xs text-muted-foreground">Last date {dmy(state.lastDate)}</span>}
            <Button variant="outline" size="sm" onClick={exportCsv}><Download className="mr-1 h-4 w-4" />CSV</Button>
            {editable && <Button variant="outline" size="sm" disabled={saving || (dirty.size === 0 && cieDirty.size === 0)} onClick={() => void save()}>{saving ? "Saving..." : "Save"}</Button>}
            {editable && <Button size="sm" disabled={saving} onClick={() => setConfirmSubmit(true)}>Submit</Button>}
            {canReopen && sheet.status === "SUBMITTED" && <Button size="sm" variant="outline" onClick={() => setReopen(true)}>Reopen</Button>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-2 w-40 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
          <span className="text-sm">{complete} of {sheet.entries.length} students complete</span>
          {savedAt && editable && <span className="text-xs text-muted-foreground">Saved {formatDateTime(new Date(savedAt))}</span>}
          <div className="relative ml-auto w-48">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Find Regd. No" value={find} onChange={(e) => setFind(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={pendingOnly} onCheckedChange={(v) => setPendingOnly(v === true)} />Pending Only</label>
        </div>
        {mode === "faculty" && !editable && state?.reason && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{state.reason}</p>}
        {editable && <p className="text-xs text-muted-foreground">Type a mark in each box, or <b>-</b> if the question was not attempted. Tick AB for an absent student. Enter and arrow keys move between boxes; marks save on their own.</p>}
        {sheet.history?.length ? <p className="text-xs text-muted-foreground">{sheet.history.slice(-1).map((h) => `${h.action === "SUBMITTED" ? "Submitted" : "Reopened"} by ${h.byName} on ${formatDateTime(new Date(h.at))}${h.reason ? ` - ${h.reason}` : ""}`)}</p> : null}
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/60">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Regd. No / Name</th>
              {q.columns.map((c) => <th key={c.key} className={cn("px-1 py-2 text-center font-medium", pairStart.has(c.key) && "pl-0")}>{pairStart.has(c.key) ? <span className="mr-1 text-[10px]">or</span> : null}{c.label}<span className="block text-[10px] font-normal">/{c.max}</span></th>)}
              <th className="px-2 py-2 text-center font-medium">AB</th>
              <th className="px-3 py-2 text-right font-medium">Total<span className="block text-[10px] font-normal">/{q.paperMax}</span></th>
              {cie && <th className="px-2 py-2 text-center font-medium">CIE U{cie.unit}<span className="block text-[10px] font-normal">/{cie.unitMarks}</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((e, ri) => {
              const r = rows[e.studentId] ?? rowOf(e);
              const ent = asEntry(q, r);
              const done = isComplete(q, ent);
              const total = r.absent ? 0 : runningTotal(q, ent);
              return (
                <tr key={e.studentId} className={cn(done ? "" : "bg-amber-50/40 dark:bg-amber-950/10")}>
                  <td className="px-3 py-1.5"><span className="font-medium tabular-nums">{e.rollNumber || "-"}</span><span className="block max-w-[220px] truncate text-xs text-muted-foreground">{e.name}</span></td>
                  {q.columns.map((c, ci) => {
                    const text = r.q[c.key] ?? "";
                    return (
                      <td key={c.key} className="px-1 py-1.5 text-center">
                        <input
                          data-r={ri} data-c={ci} inputMode="decimal" disabled={!editable || r.absent} value={r.absent ? "" : text} placeholder={r.absent ? "AB" : ""}
                          onChange={(ev) => setBox(e.studentId, c.key, ev.target.value)} onKeyDown={move} onFocus={(ev) => ev.currentTarget.select()}
                          aria-label={`${e.rollNumber} ${c.label}`}
                          className={cn("h-8 w-12 rounded-md border bg-background text-center tabular-nums outline-none focus:ring-2 focus:ring-primary disabled:bg-muted/50",
                            boxError(text, c.max) && "border-destructive ring-1 ring-destructive")}
                        />
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-center"><Checkbox checked={r.absent} disabled={!editable} onCheckedChange={(v) => setAbsent(e.studentId, v === true)} aria-label={`${e.rollNumber} absent`} /></td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{r.absent ? "AB" : done ? total : <span className="text-muted-foreground">{total}</span>}</td>
                  {cie && (
                    <td className="px-2 py-1.5 text-center">
                      <input
                        inputMode="decimal" disabled={!cieEditable || r.absent} value={r.absent ? "AB" : cieText[e.studentId] ?? ""}
                        onChange={(ev) => { setCieText((p) => ({ ...p, [e.studentId]: ev.target.value })); setCieDirty((d) => new Set(d).add(e.studentId)); }}
                        aria-label={`${e.rollNumber} CIE`}
                        className="h-8 w-12 rounded-md border bg-background text-center tabular-nums outline-none focus:ring-2 focus:ring-primary disabled:bg-muted/50"
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{pendingOnly ? "Every student is complete." : "No students match."}</p>}
      </Card>

      <Dialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Mid-{sheet.midNumber} Marks</DialogTitle>
            <DialogDescription>{sheet.subjectName}, {sheet.sectionName}: {complete} of {sheet.entries.length} students complete. After submitting you can&apos;t change the marks unless the Exam Cell reopens the sheet.{cie ? " The CIE marks are submitted too." : ""}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSubmit(false)}>Cancel</Button>
            <Button onClick={() => void submit()}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reopen} onOpenChange={setReopen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reopen Sheet</DialogTitle>
            <DialogDescription>The faculty member can change the marks again and must submit them again. They are told the reason.</DialogDescription>
          </DialogHeader>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopen(false)}>Cancel</Button>
            <Button disabled={!reason.trim()} onClick={() => void doReopen()}>Reopen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
