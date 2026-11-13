"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, KeyRound, Lock, Printer, Shuffle, Unlock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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

  async function choose(row: PaperChoiceRow, pick: { bankId: string; setNo: number } | "random") {
    setBusy(`${row.subjectId}|${row.branch}`);
    try {
      const res = await fetch("/api/college/mid-paper-choices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, date, subjectId: row.subjectId, branch: row.branch, ...(pick === "random" ? { random: true } : pick) }),
      });
      const json = (await res.json()) as { error?: string; choice?: PaperChoiceRow["choice"] };
      if (!res.ok) throw new Error(json.error ?? "Unable to save the choice");
      setDay((d) => d && ({ ...d, rows: d.rows.map((r) => (r === row ? { ...r, choice: json.choice ?? null } : r)) }));
      toast({ variant: "success", title: `Question paper ${json.choice?.setNo} of ${row.papers.find((p) => p.bankId === json.choice?.bankId)?.ownerName ?? ""} chosen` });
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save" }); }
    finally { setBusy(""); }
  }

  const [printing, setPrinting] = useState<PaperChoiceRow | null>(null);

  /** Finalizes (or re-lays out) the chosen paper on the server, then builds the PDF from the frozen copy. */
  async function print(row: PaperChoiceRow, layout: PaperPrintLayout, answerKey: boolean) {
    if (!row.choice || !day) return;
    setBusy(`dl|${row.subjectId}|${row.branch}|${answerKey}`);
    try {
      const res = await fetch("/api/college/mid-paper-choices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finalize", planId, date, subjectId: row.subjectId, branch: row.branch, layout }),
      });
      const json = (await res.json()) as { final?: MidPaperFinal; error?: string };
      if (!res.ok || !json.final) throw new Error(json.error ?? "Unable to finalize the paper");
      const f = json.final;
      setDay((d) => d && ({ ...d, rows: d.rows.map((r) => (r === row ? { ...r, choice: r.choice && { ...r.choice, final: { at: f.at, byName: f.byName, layout: f.layout } } } : r)) }));
      await downloadMidPaperFinalPdf(f, { answerKey, fileName: `MID${f.exam.midNumber}_${f.exam.date}_${row.branchCode}_${f.subject.code}${answerKey ? "_answer-key" : ""}${f.layout.separateParts ? "_parts" : ""}` });
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
      setDay((d) => d && ({ ...d, rows: d.rows.map((r) => (r === row ? { ...r, choice: r.choice && { ...r.choice, final: null } } : r)) }));
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
            {(plans ?? []).map((p) => <option key={p.id} value={p.id}>{p.courseName} · {ordinalYearLabel(p.year)} · Sem {p.semester} · Mid {p.midNumber}</option>)}
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
      {day && day.rows.map((row) => {
        const key = `${row.subjectId}|${row.branch}`;
        return (
          <Card key={key} className="rounded-2xl"><CardContent className="space-y-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="font-semibold">{row.subjectName} <span className="text-sm text-muted-foreground">({row.subjectCode})</span></p><p className="text-xs text-muted-foreground">{row.branch}</p></div>
              {row.choice && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setPrinting(row)}><Printer className="mr-1.5 h-4 w-4" />{row.choice.final ? "Print again" : "Print & finalize"}</Button>
                  {row.choice.final && <Button size="sm" variant="outline" onClick={() => void print(row, row.choice!.final!.layout, true)} loading={busy === `dl|${key}|true`}><KeyRound className="mr-1.5 h-4 w-4" />Answer key</Button>}
                  {row.choice.final && <Button size="sm" variant="ghost" onClick={() => void unfinalize(row)} loading={busy === `un|${key}`}><Unlock className="mr-1.5 h-4 w-4" />Un-finalize</Button>}
                </div>
              )}
            </div>
            {row.papers.length === 0 ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                No approved question paper yet.{row.pending.length ? ` ${row.pending.map((p) => `${p.ownerName}: ${p.stage}`).join("; ")}.` : " Nobody has started one."}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {row.papers.map((p) => {
                  const on = row.choice?.bankId === p.bankId && row.choice.setNo === p.setNo;
                  return (
                    <button key={`${p.bankId}|${p.setNo}`} type="button" disabled={busy === key || !!row.choice?.final} onClick={() => void choose(row, { bankId: p.bankId, setNo: p.setNo })}
                      className={`rounded-lg border px-3 py-1.5 text-left text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:border-primary/50"}`}>
                      <span className="font-medium">{p.ownerName} · Paper {p.setNo}</span>
                      <span className="block text-[11px] opacity-80">Sections {p.sections.join(", ")}</span>
                    </button>
                  );
                })}
                <Button size="sm" variant="outline" disabled={busy === key || !!row.choice?.final} onClick={() => void choose(row, "random")}><Shuffle className="mr-1.5 h-4 w-4" />Pick at random</Button>
              </div>
            )}
            {row.choice?.final && (
              <p className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-1.5 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                <Lock className="h-3.5 w-3.5" />Finalized by {row.choice.final.byName || "the Exam Cell"} · {new Date(row.choice.final.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · {row.choice.final.layout.separateParts ? "each part on its own page" : "all parts on one paper"}. Marks are entered against this paper.
              </p>
            )}
            {row.choice && <p className="text-xs text-muted-foreground">Chosen by {row.choice.chosenByName || "the Exam Cell"}{row.choice.at ? ` · ${new Date(row.choice.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : ""}</p>}
            {row.pending.length > 0 && row.papers.length > 0 && <p className="text-xs text-muted-foreground">Not approved yet: {row.pending.map((p) => `${p.ownerName} (${p.stage})`).join(", ")}</p>}
          </CardContent></Card>
        );
      })}
      {printing && <PrintDialog row={printing} busy={busy.startsWith("dl|")} onClose={() => setPrinting(null)} onPrint={(layout) => void print(printing, layout, false)} />}
    </div>
  );
}

/** Print options, chosen at print time: one paper, or each part on its own page(s) with its own time and max marks. */
function PrintDialog({ row, busy, onClose, onPrint }: { row: PaperChoiceRow; busy: boolean; onClose: () => void; onPrint: (layout: PaperPrintLayout) => void }) {
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
          <DialogTitle>Print {row.subjectName} ({row.branchCode})</DialogTitle>
          <DialogDescription>
            {row.choice?.final ? "Reprints the finalized paper - the questions stay exactly as finalized." : "Printing finalizes this paper: it is saved as printed, marks are entered against it, and the choice is locked."}
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
