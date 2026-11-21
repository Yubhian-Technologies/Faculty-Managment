"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, KeyRound, Lock, Printer, Shuffle, Unlock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import { dayLabel } from "@/lib/midTimetable/rules";
import { downloadMidPaperFinalPdf } from "@/lib/pdf/downloadMidPaperSet";
import type { PaperChoiceDay, PaperChoiceRow } from "@/lib/midPapers/clientTypes";
import type { MidExamPlan, MidPaperFinal, MidTimetable, PaperPrintLayout } from "@/types";

// Exam Cell > Mid Question Paper (a college that prepares question papers): pick a Mid timetable and an exam day;
// every subject + branch written that day lists the faculty's APPROVED question papers. Choose one (or "Pick at
// random") - the choice is saved - then Print: all parts on one paper, or each part on its own page(s) with its own
// header (time + max marks), decided at print time. Printing FINALIZES the paper: a frozen copy is saved for marks
// entry and the faculty's view, and the choice is locked (Un-finalize while no marks are entered).

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
type Plan = MidExamPlan & { timetables: { branch: string; status: string }[] };
type PlanDetail = { plan: MidExamPlan; branches: { branch: string; timetable: MidTimetable | null }[] };

export function PaperChoices() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [planId, setPlanId] = useState("");
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [date, setDate] = useState("");
  const [day, setDay] = useState<PaperChoiceDay | null>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    fetch("/api/college/mid-timetables").then((r) => r.json() as Promise<{ plans?: Plan[] }>).then((d) => setPlans(d.plans ?? [])).catch(() => setPlans([]));
  }, []);
  useEffect(() => {
    if (!planId) return;
    let off = false;
    fetch(`/api/college/mid-timetables/${encodeURIComponent(planId)}`).then((r) => r.json() as Promise<PlanDetail>).then((d) => { if (!off) setDetail(d); })
      .catch(() => toast({ variant: "destructive", title: "Unable to load the timetable" }));
    return () => { off = true; };
  }, [planId]);
  const dates = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of detail?.branches ?? []) for (const s of b.timetable?.slots ?? []) m.set(s.date, (m.get(s.date) ?? 0) + 1);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [detail]);

  async function load(d = date) {
    if (!planId || !d) return;
    setBusy("load");
    try {
      const res = await fetch(`/api/college/mid-paper-choices?${new URLSearchParams({ planId, date: d })}`);
      const json = (await res.json()) as PaperChoiceDay & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Unable to load");
      setDay(json);
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to load" }); }
    finally { setBusy(""); }
  }

  async function choose(row: PaperChoiceRow, pick: { bankId: string; setNo: number } | "random", quiet = false): Promise<boolean> {
    setBusy(`${row.subjectId}|${row.branch}`);
    try {
      const res = await fetch("/api/college/mid-paper-choices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, date, subjectId: row.subjectId, branch: row.branch, ...(pick === "random" ? { random: true } : pick) }),
      });
      const json = (await res.json()) as { error?: string; choice?: PaperChoiceRow["choice"] };
      if (!res.ok) throw new Error(json.error ?? "Unable to save the choice");
      setDay((d) => d && ({ ...d, rows: d.rows.map((r) => (sameRow(r, row) ? { ...r, choice: json.choice ?? null } : r)) }));
      if (!quiet) toast({ variant: "success", title: `Question paper ${json.choice?.setNo} of ${row.papers.find((p) => p.bankId === json.choice?.bankId)?.ownerName ?? ""} chosen.` });
      return true;
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save" }); return false; }
    finally { setBusy(""); }
  }

  /** One paper for several branches of a subject (e.g. Paper 1 for EEE and ECE): saved for each branch. */
  async function chooseFor(rows: PaperChoiceRow[], pick: { bankId: string; setNo: number }) {
    let done = 0;
    for (const r of rows) if (await choose(r, pick, true)) done++;
    if (done) toast({ variant: "success", title: `Question paper ${pick.setNo} chosen for ${done} branch${done === 1 ? "" : "es"}.` });
  }

  // The branches being printed together (they share the chosen paper).
  const [printing, setPrinting] = useState<PaperChoiceRow[] | null>(null);

  /** Finalizes the chosen paper for every branch of the group on the server, then builds ONE PDF whose header names
   *  just those branches (e.g. "EEE, ECE") from the frozen copy. */
  async function print(rows: PaperChoiceRow[], layout: PaperPrintLayout, answerKey: boolean) {
    if (!day || rows.length === 0 || rows.some((r) => !r.choice)) return;
    setBusy(`dl|${groupKey(rows)}|${answerKey}`);
    try {
      const finals: MidPaperFinal[] = [];
      for (const row of rows) {
        const res = await fetch("/api/college/mid-paper-choices", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "finalize", planId, date, subjectId: row.subjectId, branch: row.branch, layout }),
        });
        const json = (await res.json()) as { final?: MidPaperFinal; error?: string };
        if (!res.ok || !json.final) throw new Error(`${row.branch}: ${json.error ?? "Unable to finalize the paper"}`);
        const f = json.final;
        finals.push(f);
        setDay((d) => d && ({ ...d, rows: d.rows.map((r) => (sameRow(r, row) ? { ...r, choice: r.choice && { ...r.choice, final: { at: f.at, byName: f.byName, layout: f.layout } } } : r)) }));
      }
      const f = finals[0];
      const codes = rows.map((r) => r.branchCode);
      const printed = rows.length === 1 ? f : { ...f, branchCode: codes.join(", "), sections: [] };
      await downloadMidPaperFinalPdf(printed, { answerKey, fileName: `MID${f.exam.midNumber}_${f.exam.date}_${codes.join("-")}_${f.subject.code}${answerKey ? "_answer-key" : ""}${f.layout.separateParts ? "_parts" : ""}` });
      setPrinting(null);
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to make the PDF" }); }
    finally { setBusy(""); }
  }

  async function unfinalize(row: PaperChoiceRow) {
    if (!window.confirm(`Un-finalize the question paper of ${row.subjectName} (${row.branch})? Do this only if it must be changed - it can't be once marks are entered.`)) return;
    setBusy(`un|${row.subjectId}|${row.branch}`);
    try {
      const res = await fetch(`/api/college/mid-paper-choices?${new URLSearchParams({ planId, date, subjectId: row.subjectId, branch: row.branch })}`, { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Unable to un-finalize");
      setDay((d) => d && ({ ...d, rows: d.rows.map((r) => (sameRow(r, row) ? { ...r, choice: r.choice && { ...r.choice, final: null } } : r)) }));
      toast({ variant: "success", title: "Un-finalized - you can choose another paper" });
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to un-finalize" }); }
    finally { setBusy(""); }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Mid Question Paper" description="For every subject written on an examination day, choose which of the faculty's approved question papers is used, then download it and its answer key. Faculty are not told which paper was chosen." />
      <Card className="rounded-2xl"><CardContent className="grid gap-3 p-5 sm:grid-cols-3">
        <div className="space-y-1.5"><Label htmlFor="pc-plan">Mid timetable</Label>
          <select id="pc-plan" className={selectClass} value={planId} onChange={(e) => { setPlanId(e.target.value); setDetail(null); setDate(""); setDay(null); }}>
            <option value="">{plans === null ? "Loading..." : plans.length ? "Select a Mid timetable" : "No Mid timetable yet"}</option>
            {(plans ?? []).map((p) => <option key={p.id} value={p.id}>{p.courseName} · {ordinalYearLabel(p.year)} · Semester {p.semester} · Mid {p.midNumber}</option>)}
          </select>
        </div>
        <div className="space-y-1.5"><Label htmlFor="pc-date">Exam date</Label>
          <select id="pc-date" className={selectClass} value={date} disabled={!detail} onChange={(e) => { setDate(e.target.value); setDay(null); void load(e.target.value); }}>
            <option value="">{detail && dates.length === 0 ? "No exams placed yet" : "Select the date"}</option>
            {dates.map(([d, n]) => <option key={d} value={d}>{dayLabel(d)} · {n} subject{n === 1 ? "" : "s"}</option>)}
          </select>
        </div>
      </CardContent></Card>

      {busy === "load" && <div className="h-40 animate-pulse rounded-lg bg-muted" />}
      {day && subjectsOf(day.rows).map((rows) => (
        <SubjectCard key={rows[0].subjectId} rows={rows} busy={busy}
          onChoose={(r, pick) => void choose(r, pick)} onChooseFor={(rs, pick) => void chooseFor(rs, pick)}
          onPrint={(rs) => setPrinting(rs)} onAnswerKey={(rs) => void print(rs, rs[0].choice!.final!.layout, true)} onUnfinalize={(r) => void unfinalize(r)} />
      ))}
      {printing && <PrintDialog rows={printing} busy={busy.startsWith("dl|")} onClose={() => setPrinting(null)} onPrint={(layout) => void print(printing, layout, false)} />}
    </div>
  );
}

/** Print options, chosen at print time: one paper, or each part on its own page(s) with its own time and max marks. */
function PrintDialog({ rows, busy, onClose, onPrint }: { rows: PaperChoiceRow[]; busy: boolean; onClose: () => void; onPrint: (layout: PaperPrintLayout) => void }) {
  const row = rows[0];
  const was = row.choice?.final?.layout;
  const [separate, setSeparate] = useState(!!was?.separateParts);
  const [parts, setParts] = useState(() => row.parts.map((p) => {
    const w = was?.parts?.find((x) => x.partId === p.id);
    return { partId: p.id, label: p.label, durationMinutes: String(w?.durationMinutes ?? row.durationMinutes), maxMarks: String(w?.maxMarks ?? p.max) };
  }));
  const canSplit = row.parts.length > 1;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Print {row.subjectName} ({rows.map((r) => r.branchCode).join(", ")})</DialogTitle>
          <DialogDescription>
            {rows.every((r) => r.choice?.final) ? "Reprints the finalized paper - the questions stay exactly as finalized." : `Printing finalizes this paper for ${rows.length === 1 ? "this branch" : `these ${rows.length} branches`}: it is saved as printed, marks are entered against it, and the choice is locked. One paper is printed, naming only these branches.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="flex items-start gap-2"><input type="radio" name="pl" className="mt-1" checked={!separate} onChange={() => setSeparate(false)} />
            <span><b>All parts on one paper</b><br /><span className="text-xs text-muted-foreground">One header, then every part.</span></span></label>
          <label className={`flex items-start gap-2 ${canSplit ? "" : "opacity-50"}`}><input type="radio" name="pl" className="mt-1" disabled={!canSplit} checked={separate} onChange={() => setSeparate(true)} />
            <span><b>Each part on its own page</b><br /><span className="text-xs text-muted-foreground">{canSplit ? "Every part starts on a new page with its own full header (Regd. No boxes, letterhead), its own time and max marks." : "This paper has one part."}</span></span></label>
          {separate && (
            <div className="space-y-2 rounded-md border p-3">
              {parts.map((p, i) => (
                <div key={p.partId} className="grid grid-cols-[minmax(0,1fr)_6rem_6rem] items-end gap-2">
                  <span className="pb-2 font-medium">{p.label}</span>
                  <div className="space-y-1"><Label htmlFor={`pt-${p.partId}`} className="text-xs">Time (min)</Label>
                    <Input id={`pt-${p.partId}`} inputMode="numeric" value={p.durationMinutes} onChange={(e) => setParts((cur) => cur.map((x, j) => (j === i ? { ...x, durationMinutes: e.target.value } : x)))} /></div>
                  <div className="space-y-1"><Label htmlFor={`pm-${p.partId}`} className="text-xs">Max marks</Label>
                    <Input id={`pm-${p.partId}`} inputMode="numeric" value={p.maxMarks} onChange={(e) => setParts((cur) => cur.map((x, j) => (j === i ? { ...x, maxMarks: e.target.value } : x)))} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={() => onPrint(separate ? { separateParts: true, parts: parts.map((p) => ({ partId: p.partId, durationMinutes: Number(p.durationMinutes), maxMarks: Number(p.maxMarks) })) } : { separateParts: false })}>
            <Download className="mr-1.5 h-4 w-4" />{row.choice?.final ? "Print" : "Finalize & print"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Used only from a click handler (a random pick), never while drawing.
const randomIndex = (n: number) => Math.floor(Math.random() * n);
const sameRow = (a: PaperChoiceRow, b: PaperChoiceRow) => a.subjectId === b.subjectId && a.branch === b.branch;
const paperKey = (p: { bankId: string; setNo: number }) => `${p.bankId}|${p.setNo}`;
const groupKey = (rows: PaperChoiceRow[]) => `${rows[0]?.subjectId}|${rows.map((r) => r.branch).join("+")}`;

/** The day's rows (one per subject + branch) grouped by subject, in subject order. */
function subjectsOf(rows: PaperChoiceRow[]): PaperChoiceRow[][] {
  const by = new Map<string, PaperChoiceRow[]>();
  for (const r of [...rows].sort((a, b) => a.subjectName.localeCompare(b.subjectName) || a.branch.localeCompare(b.branch))) {
    by.set(r.subjectId, [...(by.get(r.subjectId) ?? []), r]);
  }
  return [...by.values()];
}

/**
 * One subject of the exam day. Papers prepared for it are listed with the branches each can serve (a paper made for
 * one branch serves only that branch; a paper for several or all branches serves each of them). The Exam Cell gives a
 * paper to a set of branches (e.g. Paper 1 for EEE and ECE, Paper 2 for CSE) or picks at random for them; then each
 * group of branches sharing a paper is printed once, its header naming just those branches. Each branch keeps its own
 * choice (marks are entered per branch).
 */
function SubjectCard({ rows, busy, onChoose, onChooseFor, onPrint, onAnswerKey, onUnfinalize }: {
  rows: PaperChoiceRow[]; busy: string;
  onChoose: (row: PaperChoiceRow, pick: { bankId: string; setNo: number } | "random") => void;
  onChooseFor: (rows: PaperChoiceRow[], pick: { bankId: string; setNo: number }) => void;
  onPrint: (rows: PaperChoiceRow[]) => void;
  onAnswerKey: (rows: PaperChoiceRow[]) => void;
  onUnfinalize: (row: PaperChoiceRow) => void;
}) {
  const head = rows[0];
  // Every approved paper of the subject, with the branches it can serve.
  const papers = useMemo(() => {
    const m = new Map<string, { bankId: string; setNo: number; ownerName: string; branches: PaperChoiceRow[] }>();
    for (const r of rows) for (const p of r.papers) {
      const k = paperKey(p);
      const cur = m.get(k) ?? { bankId: p.bankId, setNo: p.setNo, ownerName: p.ownerName, branches: [] };
      cur.branches.push(r);
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => a.ownerName.localeCompare(b.ownerName) || a.setNo - b.setNo);
  }, [rows]);
  const [paper, setPaper] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const selected = rows.filter((r) => picked.has(r.branch) && !r.choice?.final);
  const chosenPaper = papers.find((p) => paperKey(p) === paper);
  // A paper can only go to branches it was prepared for.
  const unservable = chosenPaper ? selected.filter((r) => !chosenPaper.branches.some((b) => sameRow(b, r))) : [];
  // Papers that every selected branch can take (for "Pick at random").
  const common = papers.filter((p) => selected.length > 0 && selected.every((r) => p.branches.some((b) => sameRow(b, r))));
  const working = busy.startsWith(`${head.subjectId}|`);
  // One paper picked at random among those prepared for every ticked branch, given to all of them.
  function pickRandom() {
    const p = common[randomIndex(common.length)];
    if (!p) return;
    onChooseFor(selected, { bankId: p.bankId, setNo: p.setNo });
    setPicked(new Set());
  }

  // Branches sharing the same chosen paper print together.
  const groups = useMemo(() => {
    const m = new Map<string, PaperChoiceRow[]>();
    for (const r of rows) if (r.choice) m.set(paperKey(r.choice), [...(m.get(paperKey(r.choice)) ?? []), r]);
    return [...m.entries()].map(([k, rs]) => ({ key: k, rows: rs, paper: papers.find((p) => paperKey(p) === k) }));
  }, [rows, papers]);

  return (
    <Card className="rounded-2xl"><CardContent className="space-y-4 p-5">
      <div>
        <p className="font-semibold">{head.subjectName} <span className="text-sm text-muted-foreground">({head.subjectCode})</span></p>
        {rows.some((r) => r.partSections) ? (
          // Taught in parts: one paper per part; each section writes the part it covers in this Mid.
          rows.map((r) => <p key={r.branch} className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{r.branchCode}</span> - {r.partSections?.length ?? 0} section{r.partSections?.length === 1 ? "" : "s"}: {(r.partSections ?? []).join(", ")}</p>)
        ) : (
          <p className="text-xs text-muted-foreground">{rows.length} branch{rows.length === 1 ? "" : "es"}: {rows.map((r) => r.branchCode).join(", ")}</p>
        )}
      </div>

      {papers.length === 0 ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          No approved question paper yet.{rows.some((r) => r.pending.length) ? ` ${[...new Set(rows.flatMap((r) => r.pending.map((p) => `${p.ownerName}: ${p.stage}`)))].join("; ")}.` : " Nobody has started one."}
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Papers prepared</p>
            <ul className="space-y-1 text-sm">
              {papers.map((p) => (
                <li key={paperKey(p)}><span className="font-medium">{p.ownerName} · Paper {p.setNo}</span>
                  <span className="text-xs text-muted-foreground"> - for {p.branches.length === rows.length && rows.length > 1 ? "all branches" : p.branches.map((b) => b.branchCode).join(", ")}</span></li>
              ))}
            </ul>
          </div>

          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <p className="text-sm font-medium">Give a paper to branches</p>
            <div className="flex flex-wrap gap-3">
              {rows.map((r) => (
                <label key={r.branch} className={`flex items-center gap-1.5 text-sm ${r.choice?.final ? "opacity-50" : ""}`} title={r.choice?.final ? "Finalized - un-finalize it to change" : r.branch}>
                  <Checkbox checked={picked.has(r.branch)} disabled={!!r.choice?.final} onCheckedChange={(v) => setPicked((s) => { const n = new Set(s); if (v === true) n.add(r.branch); else n.delete(r.branch); return n; })} />{r.branchCode}
                </label>
              ))}
              {rows.length > 1 && (
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => setPicked(new Set(rows.filter((r) => !r.choice?.final).map((r) => r.branch)))}>All</button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Question paper" className={`${selectClass} w-auto min-w-64`} value={paper} onChange={(e) => setPaper(e.target.value)}>
                <option value="">Choose a paper</option>
                {papers.map((p) => <option key={paperKey(p)} value={paperKey(p)}>{p.ownerName} · Paper {p.setNo}</option>)}
              </select>
              <Button size="sm" disabled={working || !chosenPaper || selected.length === 0 || unservable.length > 0}
                onClick={() => { onChooseFor(selected, { bankId: chosenPaper!.bankId, setNo: chosenPaper!.setNo }); setPicked(new Set()); }}>
                Use for Selected Branches
              </Button>
              <Button size="sm" variant="outline" disabled={working || common.length === 0}
                title={selected.length && !common.length ? "No single paper was prepared for all the ticked branches" : undefined}
                onClick={pickRandom}>
                <Shuffle className="mr-1.5 h-4 w-4" />Pick at Random
              </Button>
            </div>
            {unservable.length > 0 && <p className="text-xs text-destructive">This paper was not prepared for {unservable.map((r) => r.branchCode).join(", ")}. Untick them or choose another paper.</p>}
          </div>

          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 pr-3">Branch</th><th className="py-1.5 pr-3">Paper</th><th className="py-1.5" /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.branch} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-3"><span className="font-medium">{r.branchCode}</span><span className="block text-xs text-muted-foreground">{r.branch}</span></td>
                  <td className="py-2 pr-3">
                    {r.papers.length === 0 ? <span className="text-xs text-amber-700">No approved paper for this branch</span> : (
                      <select aria-label={`Paper for ${r.branchCode}`} className={`${selectClass} w-auto min-w-56`} disabled={working || !!r.choice?.final}
                        value={r.choice ? paperKey(r.choice) : ""} onChange={(e) => { const p = r.papers.find((x) => paperKey(x) === e.target.value); if (p) onChoose(r, { bankId: p.bankId, setNo: p.setNo }); }}>
                        <option value="">Not chosen</option>
                        {r.papers.map((p) => <option key={paperKey(p)} value={paperKey(p)}>{p.ownerName} · Paper {p.setNo}</option>)}
                      </select>
                    )}
                    {r.choice?.final && <span className="mt-1 flex items-center gap-1 text-xs text-emerald-700"><Lock className="h-3 w-3" />Finalized {new Date(r.choice.final.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>}
                  </td>
                  <td className="py-2 text-right">
                    {r.choice?.final && <Button size="sm" variant="ghost" onClick={() => onUnfinalize(r)} loading={busy === `un|${r.subjectId}|${r.branch}`}><Unlock className="mr-1.5 h-4 w-4" />Un-finalize</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {groups.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Print</p>
              {groups.map((g) => {
                const allFinal = g.rows.every((r) => r.choice?.final);
                return (
                  <div key={g.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
                    <span className="text-sm"><b>{g.paper ? `${g.paper.ownerName} · Paper ${g.paper.setNo}` : "Chosen paper"}</b> for {g.rows.map((r) => r.branchCode).join(", ")}</span>
                    <span className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => onPrint(g.rows)}><Printer className="mr-1.5 h-4 w-4" />{allFinal ? "Print Again" : "Print & Finalize"}</Button>
                      {allFinal && <Button size="sm" variant="outline" onClick={() => onAnswerKey(g.rows)} loading={busy === `dl|${groupKey(g.rows)}|true`}><KeyRound className="mr-1.5 h-4 w-4" />Answer Key</Button>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </CardContent></Card>
  );
}
