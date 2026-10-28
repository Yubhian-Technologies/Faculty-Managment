"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BarChart3, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Cloud, CloudOff, Copy, Eye, ImagePlus, ListChecks, Loader2, Lock, Target, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { BLOOM_LABELS, BLOOM_LEVELS, BLOOM_MIN_PER_UNIT, PROGRAM_OUTCOMES, QUESTIONS_PER_UNIT } from "@/lib/midBank/constants";
import { derivePoPso } from "@/lib/midBank/outcomes";
import { bloomNeeds, lockReason } from "@/lib/midBank/rules";
import { allowedFormats, bankFormats, defaultSplit, formatsFor, formatName, formatOf, isBlankPart, partLabel, partLetter, partMarks, partsFor, questionErrors, questionFormat } from "@/lib/midBank/validateQuestion";
import type { MidBankDetail } from "@/lib/midBank/clientTypes";
import type { BloomLevel, MidQuestion, MidQuestionBank, MidQuestionFormat, MidQuestionPart, MidUnitStatus } from "@/types";
import { MathText, QuestionTextField } from "./MathText";

// Stage 3 + 4: write the bank. Left - units and their 10 slots; centre - the
// question editor; right - COs, derived POs/PSOs, Bloom tally, preview and
// what is still missing. Drafts save by themselves (1.5 s after typing stops);
// a complete question is only re-saved by "Save question", which re-checks it.
// The server decides what is complete; the hints here are live previews of it.

type SaveState = "idle" | "saving" | "saved" | "failed" | "conflict";
type Tab = "nav" | "editor" | "info";
const AUTOSAVE_MS = 1500;

const emptyParts = (format: MidQuestionFormat, total: number): MidQuestionPart[] =>
  defaultSplit(format, total).map((marks) => ({ text: "", cos: [], bloom: "", marks }));
const qidOf = (unit: number, slot: number) => `${unit}_${slot}`;
/** Question text for a one-line list: formulas shown as [formula], spaces folded. */
const plainText = (t: string) => t.replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, "[formula]").replace(/\s+/g, " ").trim();

function slotState(q: MidQuestion | undefined, attention: boolean): { label: string; cls: string } {
  if (attention) return { label: "Needs attention", cls: "border-destructive bg-destructive/10 text-destructive" };
  if (!q) return { label: "Empty", cls: "border-dashed text-muted-foreground" };
  if (q.state === "COMPLETE") return { label: "Complete", cls: "border-green-600/50 bg-green-600/10 text-green-800" };
  return { label: "Draft", cls: "border-amber-500/60 bg-amber-500/10 text-amber-800" };
}

export function BankWorkspace({ detail, initialQ }: { detail: MidBankDetail; initialQ?: string }) {
  const outcomes = detail.outcomes!;
  const [bank, setBank] = useState<MidQuestionBank>(detail.bank!);
  const [questions, setQuestions] = useState<Record<string, MidQuestion>>(() => Object.fromEntries(detail.questions.map((q) => [q.id, q])));
  const firstOpen = bank.units.find((u) => !bank.unitStatus[String(u)]?.complete) ?? bank.units[0];
  const [cur, setCur] = useState(() => {
    // A question asked for in the URL (from the review screen), if its unit is open.
    const m = /^(\d+)_(\d+)$/.exec(initialQ ?? "");
    if (m && bank.units.includes(Number(m[1])) && !lockReason(bank.units, bank.unitStatus, Number(m[1]))) return { unit: Number(m[1]), slot: Number(m[2]) };
    const unit = firstOpen;
    const slot = Array.from({ length: QUESTIONS_PER_UNIT }, (_, i) => i + 1).find((s) => questions[qidOf(unit, s)]?.state !== "COMPLETE") ?? 1;
    return { unit, slot };
  });
  const qid = qidOf(cur.unit, cur.slot);
  // The question types the Exam Cell allows; with more than one, each question picks. A new question starts with the first.
  // Live from the Exam Cell's current rule; a saved question also keeps its own type.
  const bankAllowed = bankFormats(bank, detail.rules);
  const defaultFormat = questionFormat(bankAllowed);
  const fmtOf = (q: MidQuestion | undefined | null): MidQuestionFormat => (q ? formatOf(q, allowedFormats(bank)) : defaultFormat);
  const [qFormat, setQFormat] = useState<MidQuestionFormat>(() => fmtOf(questions[qid]));
  const [parts, setParts] = useState<MidQuestionPart[]>(() => questions[qid]?.parts ?? emptyParts(fmtOf(questions[qid]), bank.marks));
  const [rev, setRev] = useState(questions[qid]?.rev ?? 0);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [attention, setAttention] = useState<Set<string>>(new Set());
  const [conflict, setConflict] = useState<MidQuestion | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("editor");
  const [copyOpen, setCopyOpen] = useState(false);

  // Serialise saves: one request at a time, edits made meanwhile are saved after it.
  const inFlight = useRef<Promise<boolean> | null>(null);
  const editSeq = useRef(0);
  const latest = useRef({ parts, rev, qid, dirty, qFormat });
  useEffect(() => { latest.current = { parts, rev, qid, dirty, qFormat }; }, [parts, rev, qid, dirty, qFormat]);

  const current = questions[qid];
  const allowed = formatsFor(bankAllowed, current ? fmtOf(current) : null);
  const isComplete = current?.state === "COMPLETE";
  const unitStatus: MidUnitStatus = bank.unitStatus[String(cur.unit)] ?? { complete: false, completeCount: 0, draftCount: 0, bloom: { L2: 0, L3: 0, L4: 0 } };
  const unitTitle = (u: number) => outcomes.units.find((x) => x.no === u)?.title ?? "";

  const edit = (i: number, patch: Partial<MidQuestionPart>) => {
    editSeq.current++;
    setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
    setDirty(true);
    setSaveState((s) => (s === "saved" ? "idle" : s));
  };

  const save = useCallback(async (action: "draft" | "complete"): Promise<boolean> => {
    async function send(): Promise<boolean> {
      const sent = { ...latest.current, seq: editSeq.current };
      setSaveState("saving");
      try {
        const res = await fetch(`/api/college/mid-question-banks/${encodeURIComponent(bank.id)}/questions/${sent.qid}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, format: sent.qFormat, parts: sent.parts, baseRev: sent.rev }),
        });
        const data = (await res.json()) as {
          error?: string; errors?: Record<string, string>; warnings?: string[]; question?: MidQuestion | null;
          unitStatus?: MidUnitStatus; bank?: { completeCount: number; totalCount: number; status: MidQuestionBank["status"] };
        };
        if (res.status === 409 && data.question !== undefined && !data.errors) {
          setConflict(data.question ?? null);
          setSaveState("conflict");
          return false;
        }
        if (!res.ok) {
          // 400 / 409 / 403 are answers (shown in the toast and beside the fields), not a failed save.
          setSaveState(res.status >= 500 ? "failed" : "idle");
          if (data.errors) setFieldErrors(data.errors);
          if (action === "complete") setAttention((s) => new Set(s).add(sent.qid));
          toast({ variant: "destructive", title: data.error ?? "Could not save" });
          return false;
        }
        // Saved.
        const unit = Number(sent.qid.split("_")[0]);
        setQuestions((qs) => {
          const next = { ...qs };
          if (data.question) next[sent.qid] = data.question; else delete next[sent.qid];
          return next;
        });
        if (data.unitStatus) setBank((b) => ({ ...b, unitStatus: { ...b.unitStatus, [String(unit)]: data.unitStatus! }, ...(data.bank ?? {}) }));
        setAttention((s) => { const n = new Set(s); n.delete(sent.qid); return n; });
        if (latest.current.qid === sent.qid) {
          setRev(data.question?.rev ?? 0);
          setFieldErrors({});
          setWarnings(data.warnings ?? []);
          // Still dirty if the faculty typed while this save was on its way.
          if (editSeq.current === sent.seq) setDirty(false);
        }
        setSaveState("saved");
        return true;
      } catch {
        setSaveState("failed");
        return false;
      }
    }

    // One request at a time: wait for the one on its way, then save what is current.
    while (inFlight.current) await inFlight.current;
    const run = send();
    inFlight.current = run;
    try { return await run; } finally { if (inFlight.current === run) inFlight.current = null; }
  }, [bank.id]);

  // Autosave drafts (never a complete question - that needs "Save question").
  useEffect(() => {
    if (!dirty || isComplete || saveState === "conflict" || saveState === "saving") return;
    const t = setTimeout(() => { void save("draft"); }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [dirty, parts, isComplete, saveState, save]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (latest.current.dirty || inFlight.current) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function load(unit: number, slot: number) {
    const id = qidOf(unit, slot);
    const q = questions[id];
    setCur({ unit, slot });
    setQFormat(fmtOf(q));
    setParts(q?.parts ?? emptyParts(fmtOf(q), bank.marks));
    setRev(q?.rev ?? 0);
    setDirty(false);
    setFieldErrors({});
    setWarnings([]);
    setConflict(null);
    setSaveState("idle");
    setTab("editor");
  }

  /** Leave the current question safely: drafts are saved, a complete question must still pass. */
  async function go(unit: number, slot: number) {
    if (unit === cur.unit && slot === cur.slot) return;
    if (dirty) {
      const ok = await save(isComplete ? "complete" : "draft");
      if (!ok) return;
    }
    load(unit, slot);
  }

  function nextSlot(): { unit: number; slot: number } | null {
    if (cur.slot < QUESTIONS_PER_UNIT) return { unit: cur.unit, slot: cur.slot + 1 };
    const i = bank.units.indexOf(cur.unit);
    const nu = bank.units[i + 1];
    return nu !== undefined && !lockReason(bank.units, bank.unitStatus, nu) ? { unit: nu, slot: 1 } : null;
  }

  async function saveQuestion(andNext: boolean) {
    const ok = await save("complete");
    if (!ok) return;
    toast({ variant: "success", title: `Unit ${cur.unit} Q${cur.slot} saved` });
    if (andNext) {
      const n = nextSlot();
      if (n) load(n.unit, n.slot);
    }
  }

  async function upload(i: number, file: File) {
    setUploading(i);
    try {
      const form = new FormData();
      form.append("bankId", bank.id);
      form.append("file", file);
      const res = await fetch("/api/upload/mid-question-image", { method: "POST", body: form });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed");
      edit(i, { imageUrl: data.url });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setUploading(null);
    }
  }

  function copyFrom(id: string) {
    const src = questions[id];
    if (!src) return;
    editSeq.current++;
    // The copy keeps its type where the bank allows it; otherwise it is fitted to the bank's first.
    const f = questionFormat(allowed, fmtOf(src));
    const blank = emptyParts(f, bank.marks);
    setQFormat(f);
    setParts(blank.map((b, i) => (src.parts[i] ? { ...src.parts[i], cos: [...src.parts[i].cos], marks: f === "SINGLE" ? bank.marks : src.parts[i].marks ?? b.marks } : b)));
    setDirty(true);
    toast({ title: `Copied Unit ${src.unit} Q${src.slot}`, description: "Edit it - an identical question can't be saved as complete." });
  }

  const liveErrors = useMemo(() => questionErrors(parts, qFormat, bank.marks), [parts, qFormat, bank.marks]);

  /** Switch this question to another allowed type. Parts that would be dropped must be empty. */
  function changeFormat(f: MidQuestionFormat) {
    if (f === qFormat) return;
    const n = partsFor(f);
    const lost = parts.slice(n).findIndex((p) => !isBlankPart(p));
    if (lost >= 0) {
      toast({ variant: "destructive", title: `Clear part (${partLetter(n + lost)}) first`, description: "Its text, COs and level would be lost." });
      return;
    }
    const split = defaultSplit(f, bank.marks);
    editSeq.current++;
    setParts(split.map((marks, i) => (parts[i] ? { ...parts[i], marks } : { text: "", cos: [], bloom: "", marks })));
    setQFormat(f);
    setDirty(true);
  }
  const allCos = [...new Set(parts.flatMap((p) => p.cos))];
  const poPso = derivePoPso(allCos, outcomes.mapping);
  const lockedHere = lockReason(bank.units, bank.unitStatus, cur.unit);
  const others = Object.values(questions).filter((q) => q.id !== qid && q.parts.some((p) => p.text.trim())).sort((a, b) => a.unit - b.unit || a.slot - b.slot);
  const pct = bank.totalCount ? Math.round((bank.completeCount / bank.totalCount) * 100) : 0;

  const prevSlot = (): { unit: number; slot: number } | null => {
    if (cur.slot > 1) return { unit: cur.unit, slot: cur.slot - 1 };
    const pu = bank.units[bank.units.indexOf(cur.unit) - 1];
    return pu !== undefined ? { unit: pu, slot: QUESTIONS_PER_UNIT } : null;
  };
  const prev = prevSlot();
  const nxt = nextSlot();

  const saveBadge = {
    idle: dirty ? <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{isComplete ? "Unsaved changes - press Save question" : "Unsaved changes"}</span> : null,
    saving: <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</span>,
    saved: <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700"><Cloud className="h-3.5 w-3.5" />Saved</span>,
    failed: <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-destructive"><CloudOff className="h-3.5 w-3.5" />Save failed <button type="button" className="font-semibold underline" onClick={() => void save(isComplete ? "complete" : "draft")}>Retry</button></span>,
    conflict: null,
  }[saveState];
  const stateChip = isComplete
    ? { label: "Complete", cls: "bg-emerald-100 text-emerald-800" }
    : current ? { label: "Draft", cls: "bg-amber-100 text-amber-900" }
    : { label: "Empty", cls: "bg-muted text-muted-foreground" };

  return (
    <div className="space-y-5">
      {/* Bank progress, per unit */}
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-sm font-bold text-primary"
          style={{ background: `conic-gradient(hsl(var(--primary)) ${pct * 3.6}deg, hsl(var(--muted)) 0deg)` }}>
          <span className="grid h-11 w-11 place-items-center rounded-full bg-card">{pct}%</span>
        </div>
        <div className="min-w-48 flex-1 space-y-2">
          <p className="text-sm"><span className="text-base font-semibold">{bank.completeCount}</span><span className="text-muted-foreground"> of {bank.totalCount} questions complete</span></p>
          <div className="flex gap-1.5" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Bank progress">
            {bank.units.map((u) => {
              const st = bank.unitStatus[String(u)];
              const w = ((st?.completeCount ?? 0) / QUESTIONS_PER_UNIT) * 100;
              return (
                <div key={u} className="flex-1" title={`Unit ${u}: ${st?.completeCount ?? 0}/${QUESTIONS_PER_UNIT}`}>
                  <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", st?.complete ? "bg-emerald-500" : "bg-primary")} style={{ width: `${w}%` }} /></div>
                  <p className="mt-1 text-[11px] text-muted-foreground">Unit {u}</p>
                </div>
              );
            })}
          </div>
        </div>
        <Button asChild variant="outline">
          <Link href={`/panel/mid-bank/${encodeURIComponent(bank.id)}/review`}><ClipboardCheck className="mr-1.5 h-4 w-4" />Review bank</Link>
        </Button>
      </div>

      {/* Below lg the three panels become tabs. */}
      <div className="flex gap-1 rounded-xl border bg-muted/40 p-1 lg:hidden" role="tablist" aria-label="Workspace panels">
        {(["nav", "editor", "info"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}
            className={cn("flex-1 rounded-lg px-3 py-1.5 text-sm font-medium", tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}>
            {t === "nav" ? "Questions" : t === "editor" ? "Editor" : "Details"}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)_300px]">
        {/* Left: units and slots */}
        <nav aria-label="Units and questions" className={cn("space-y-3 lg:sticky lg:top-4 lg:self-start", tab !== "nav" && "hidden lg:block")}>
          {bank.units.map((u) => {
            const st = bank.unitStatus[String(u)];
            const reason = lockReason(bank.units, bank.unitStatus, u);
            const here = u === cur.unit;
            return (
              <section key={u} className={cn("rounded-2xl border bg-card p-3.5 shadow-sm", here && !reason && "border-primary/40 ring-1 ring-primary/20", reason && "bg-muted/30")}>
                <div className="mb-3 flex items-start gap-2.5">
                  <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-bold",
                    st?.complete ? "bg-emerald-500 text-white" : reason ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
                    {st?.complete ? <CheckCircle2 className="h-4 w-4" aria-label="Unit complete" /> : reason ? <Lock className="h-3.5 w-3.5" /> : u}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">Unit {u}</p>
                      <span className="text-xs font-medium text-muted-foreground">{st?.completeCount ?? 0}/{QUESTIONS_PER_UNIT}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground" title={unitTitle(u)}>{unitTitle(u) || "-"}</p>
                  </div>
                </div>
                {reason ? (
                  <p className="rounded-lg bg-background/60 px-2.5 py-2 text-xs text-muted-foreground">{reason}</p>
                ) : (
                  <div className="grid grid-cols-5 gap-1.5">
                    {Array.from({ length: QUESTIONS_PER_UNIT }, (_, i) => i + 1).map((s) => {
                      const id = qidOf(u, s);
                      const q = questions[id];
                      const att = attention.has(id);
                      const state = slotState(q, att);
                      const active = u === cur.unit && s === cur.slot;
                      return (
                        <button key={s} type="button" onClick={() => void go(u, s)} aria-current={active ? "true" : undefined}
                          aria-label={`Unit ${u} question ${s}: ${state.label}`} title={state.label}
                          className={cn("relative grid h-9 place-items-center rounded-lg text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            att ? "bg-destructive/10 text-destructive ring-1 ring-destructive"
                              : q?.state === "COMPLETE" ? "bg-emerald-500 text-white hover:bg-emerald-600"
                              : q ? "bg-amber-100 text-amber-900 ring-1 ring-amber-300 hover:bg-amber-200"
                              : "border border-dashed text-muted-foreground hover:border-primary/50 hover:text-foreground",
                            active && "scale-105 ring-2 ring-primary ring-offset-2 ring-offset-card")}>
                          {s}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
          <ul className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground" aria-label="Legend">
            <li className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-muted-foreground" />Empty</li>
            <li className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-300" />Draft</li>
            <li className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Complete</li>
            <li className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-destructive" />Needs attention</li>
          </ul>
        </nav>

        {/* Centre: editor */}
        <section aria-label="Question editor" className={cn("overflow-hidden rounded-2xl border bg-card shadow-sm", tab !== "editor" && "hidden lg:block")}>
          <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Previous question" disabled={!prev || saveState === "saving"} onClick={() => prev && void go(prev.unit, prev.slot)}><ChevronLeft className="h-4 w-4" /></Button>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Unit {cur.unit}{unitTitle(cur.unit) ? ` · ${unitTitle(cur.unit)}` : ""}</p>
                <h2 className="text-lg font-semibold leading-tight">Question {cur.slot} <span className="text-sm font-normal text-muted-foreground">of {QUESTIONS_PER_UNIT}</span></h2>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Next question" disabled={!nxt || saveState === "saving"} onClick={() => nxt && void go(nxt.unit, nxt.slot)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {saveBadge}
              <span className={cn("rounded-full px-2.5 py-1 font-semibold", stateChip.cls)}>{stateChip.label}</span>
            </div>
          </header>

          <div className="space-y-5 p-5">
            {saveState === "conflict" && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/50 bg-amber-50 p-3 text-sm" role="alert">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <span className="flex-1">This question was changed in another tab or window. Your edits here were not saved.</span>
                <Button size="sm" variant="outline" onClick={() => {
                  if (conflict) setQuestions((qs) => ({ ...qs, [qid]: conflict })); else setQuestions((qs) => { const n = { ...qs }; delete n[qid]; return n; });
                  setQFormat(fmtOf(conflict)); setParts(conflict?.parts ?? emptyParts(fmtOf(conflict), bank.marks)); setRev(conflict?.rev ?? 0); setDirty(false); setConflict(null); setSaveState("idle");
                }}>Load the saved version</Button>
              </div>
            )}

            {lockedHere && <p className="flex items-center gap-2 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground"><Lock className="h-4 w-4" />{lockedHere}</p>}

            {(others.length > 0 || allowed.length > 1) && !lockedHere && (
              <div className="flex flex-wrap items-center gap-3">
                {allowed.length > 1 && (
                  <fieldset className="inline-flex flex-wrap rounded-xl border bg-muted/40 p-1 text-sm">
                    <legend className="sr-only">Question format</legend>
                    {allowed.map((f) => (
                      <label key={f} className={cn("flex cursor-pointer items-center rounded-lg px-3.5 py-1.5 font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                        qFormat === f ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                        <input type="radio" name="q-format" checked={qFormat === f} onChange={() => changeFormat(f)} className="sr-only" />
                        {f === "SINGLE" ? `One question · ${bank.marks} marks` : formatName(f)}
                      </label>
                    ))}
                  </fieldset>
                )}
                {others.length > 0 && (
                  <Popover open={copyOpen} onOpenChange={setCopyOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="ml-auto shrink-0"><Copy className="mr-1.5 h-4 w-4" />Copy from…</Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-0">
                      <div className="border-b px-3 py-2.5">
                        <p className="text-sm font-semibold">Start from a copy</p>
                        <p className="text-xs text-muted-foreground">The copy replaces what is in this question; change it before saving - an identical question can&rsquo;t be completed.</p>
                      </div>
                      <ul className="max-h-80 overflow-y-auto p-1.5" aria-label="Questions to copy from">
                        {others.map((q) => (
                          <li key={q.id}>
                            <button type="button" onClick={() => { copyFrom(q.id); setCopyOpen(false); }}
                              className="flex w-full items-start gap-2.5 rounded-lg p-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                              <span className={cn("mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold", q.state === "COMPLETE" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900")}>U{q.unit} · Q{q.slot}</span>
                              <span className="min-w-0 flex-1">
                                <span className="line-clamp-2 text-sm">{plainText(q.parts[0]?.text ?? "") || <span className="italic text-muted-foreground">Formula / image only</span>}</span>
                                <span className="text-[11px] text-muted-foreground">{formatName(fmtOf(q))} · {q.parts.flatMap((p) => p.cos).filter((c, i, a) => a.indexOf(c) === i).join(", ") || "No CO"}</span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            )}
            {qFormat !== "SINGLE" && (fieldErrors.marks || (dirty && liveErrors.marks)) && (
              <p className="text-xs text-destructive">{fieldErrors.marks || liveErrors.marks}</p>
            )}

            {parts.map((p, i) => {
              const pre = `p${i}`;
              const err = (f: string) => fieldErrors[`parts.${i}.${f}`];
              return (
                <fieldset key={i} disabled={Boolean(lockedHere)} className="space-y-5 rounded-xl border bg-background p-4 sm:p-5">
                  <legend className="flex items-center gap-2 px-1 text-sm font-semibold">
                    <span className="grid h-6 min-w-6 place-items-center rounded-md bg-primary px-1.5 text-xs text-primary-foreground">{qFormat === "SINGLE" ? "Q" : partLetter(i)}</span>
                    {partLabel(qFormat, i)}
                    {qFormat === "SINGLE" ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{bank.marks} marks</span> : (
                      <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                        <input type="number" min={1} max={bank.marks - (partsFor(qFormat) - 1)} aria-label={`Marks for ${partLabel(qFormat, i)}`}
                          value={p.marks ?? ""} onChange={(e) => edit(i, { marks: e.target.value === "" ? 0 : Number(e.target.value) })}
                          className="h-7 w-14 rounded-md border border-input bg-background px-1 text-center text-sm font-semibold text-foreground" /> marks
                      </span>
                    )}
                  </legend>

                  <div className="space-y-1.5">
                    <Label htmlFor={`${pre}-text`} className="text-sm font-medium">Question text</Label>
                    <QuestionTextField id={`${pre}-text`} value={p.text} onChange={(v) => edit(i, { text: v })} invalid={Boolean(err("text"))} describedBy={err("text") ? `${pre}-text-err` : undefined}
                      placeholder="Type the question here. Use the Formula button to add a formula." />
                    {err("text") && <p id={`${pre}-text-err`} className="text-xs text-destructive">{err("text")}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-sm font-medium">Image <span className="font-normal text-muted-foreground">(optional)</span></span>
                    {p.imageUrl ? (
                      <div className="flex flex-wrap items-start gap-3 rounded-xl border bg-muted/20 p-3">
                        {/* eslint-disable-next-line @next/next/no-img-element -- Storage URL with a token, not an optimisable asset */}
                        <img src={p.imageUrl} alt={p.imageCaption || `Image for ${partLabel(qFormat, i)}`} className="max-h-40 rounded-lg border bg-white" />
                        <div className="flex flex-col gap-2">
                          <label className="inline-flex cursor-pointer items-center rounded-md border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted">
                            Replace<input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(i, f); e.target.value = ""; }} />
                          </label>
                          <button type="button" className="rounded-md px-2.5 py-1 text-left text-xs font-medium text-destructive hover:bg-destructive/10" onClick={() => edit(i, { imageUrl: undefined, imageCaption: undefined })}>Remove</button>
                        </div>
                      </div>
                    ) : (
                      <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 focus-within:ring-2 focus-within:ring-ring">
                        <span className="grid h-9 w-9 place-items-center rounded-lg bg-muted">{uploading === i ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}</span>
                        <span><span className="font-medium text-foreground">{uploading === i ? "Uploading…" : "Add an image"}</span><span className="block text-xs">PNG or JPEG, up to 1 MB</span></span>
                        <input type="file" accept="image/png,image/jpeg" className="sr-only" disabled={uploading !== null} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(i, f); e.target.value = ""; }} />
                      </label>
                    )}
                    {p.imageUrl && (
                      <Input aria-label="Image caption" placeholder="Caption (optional, up to 150 characters)" maxLength={150} value={p.imageCaption ?? ""} onChange={(e) => edit(i, { imageCaption: e.target.value })} />
                    )}
                    {err("imageCaption") && <p className="text-xs text-destructive">{err("imageCaption")}</p>}
                  </div>

                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="space-y-2">
                      <span className="text-sm font-medium" id={`${pre}-co-label`}>Course Outcome(s)</span>
                      <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`${pre}-co-label`}>
                        {outcomes.cos.map((c) => {
                          const on = p.cos.includes(c.id);
                          return (
                            <button key={c.id} type="button" aria-pressed={on} title={c.statement}
                              onClick={() => edit(i, { cos: on ? p.cos.filter((x) => x !== c.id) : [...p.cos, c.id] })}
                              className={cn("inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                on ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background hover:border-primary/50")}>
                              {on && <Check className="h-3 w-3" />}{c.id}
                            </button>
                          );
                        })}
                      </div>
                      {err("cos") && <p className="text-xs text-destructive">{err("cos")}</p>}
                    </div>

                    <fieldset className="space-y-2">
                      <legend className="text-sm font-medium">Bloom&rsquo;s level</legend>
                      <div className="grid grid-cols-3 gap-1.5">
                        {BLOOM_LEVELS.map((l) => {
                          const [code, word] = BLOOM_LABELS[l].split(" - ");
                          return (
                            <label key={l} className={cn("flex cursor-pointer flex-col items-center rounded-xl border px-2 py-1.5 text-center transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                              p.bloom === l ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background hover:border-primary/50")}>
                              <input type="radio" name={`${pre}-bloom`} value={l} checked={p.bloom === l} onChange={() => edit(i, { bloom: l as BloomLevel })} className="sr-only" />
                              <span className="text-sm font-bold">{code}</span>
                              <span className={cn("text-[11px]", p.bloom === l ? "opacity-90" : "text-muted-foreground")}>{word}</span>
                            </label>
                          );
                        })}
                      </div>
                      {err("bloom") && <p className="text-xs text-destructive">{err("bloom")}</p>}
                    </fieldset>
                  </div>
                </fieldset>
              );
            })}

            {warnings.length > 0 && (
              <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                {warnings.map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{w} - check it isn&rsquo;t a repeat.</li>)}
              </ul>
            )}
          </div>

          {!lockedHere && (
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-5 py-3">
              <span className="text-xs text-muted-foreground">{isComplete ? "Complete questions save only with Save question" : "Drafts save by themselves as you type"}</span>
              <div className="flex flex-wrap gap-2">
                {!isComplete && <Button variant="ghost" onClick={() => void save("draft")} disabled={!dirty || saveState === "saving"}>Save draft</Button>}
                <Button variant="outline" onClick={() => void saveQuestion(false)} disabled={saveState === "saving" || parts.every(isBlankPart)}>Save question</Button>
                <Button onClick={() => void saveQuestion(true)} disabled={saveState === "saving" || parts.every(isBlankPart)}>Save &amp; next<ChevronRight className="ml-1 h-4 w-4" /></Button>
              </div>
            </footer>
          )}
        </section>

        {/* Right: academic details */}
        <aside aria-label="Question details" className={cn("space-y-4 text-sm lg:sticky lg:top-4 lg:self-start", tab !== "info" && "hidden lg:block")}>
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><BarChart3 className="h-3.5 w-3.5" />Unit {cur.unit} Bloom&rsquo;s levels</p>
            <ul className="space-y-3">
              {bloomNeeds(unitStatus.bloom).map((b) => (
                <li key={b.level}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-medium">{BLOOM_LABELS[b.level as BloomLevel] ?? b.level} <span className="text-muted-foreground">· {b.count}</span></span>
                    <span className={b.need ? "font-medium text-amber-700" : "font-medium text-emerald-700"}>{b.need ? `Need ${b.need} more` : "Done"}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", b.need ? "bg-amber-400" : "bg-emerald-500")} style={{ width: `${Math.min(100, (b.count / BLOOM_MIN_PER_UNIT) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex justify-between border-t pt-3 text-xs"><span className="text-muted-foreground">Questions</span><span className="font-semibold">{unitStatus.completeCount}/{QUESTIONS_PER_UNIT} complete{unitStatus.draftCount ? `, ${unitStatus.draftCount} draft` : ""}</span></p>
          </div>

          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Target className="h-3.5 w-3.5" />Outcomes</p>
            {allCos.length === 0 ? <p className="text-xs text-muted-foreground">Pick a Course Outcome to see its POs and PSOs.</p> : (
              <>
                <ul className="mb-3 space-y-2">{allCos.map((c) => <li key={c} className="flex gap-2 text-xs"><span className="h-fit shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 font-bold text-primary">{c}</span><span>{outcomes.cos.find((x) => x.id === c)?.statement}</span></li>)}</ul>
                <div className="flex flex-wrap gap-1">
                  {poPso.map((x) => <Badge key={x} variant="secondary" className="rounded-full" title={PROGRAM_OUTCOMES.find((p) => p.id === x)?.title ?? "Programme-specific outcome"}>{x}</Badge>)}
                </div>
              </>
            )}
          </div>

          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Eye className="h-3.5 w-3.5" />Preview</p>
            <div className="space-y-3 rounded-xl border bg-white p-3 font-serif text-[15px] text-neutral-900">
              {parts.map((p, i) => (
                <div key={i}>
                  <div className="flex gap-1.5">
                    <span className="font-semibold">{qFormat !== "SINGLE" ? `(${partLetter(i)})` : `${cur.slot}.`}</span>
                    <div className="min-w-0 flex-1">
                      {p.text.trim() ? <MathText text={p.text} /> : <span className="font-sans text-sm italic text-neutral-500">Nothing written yet</span>}
                    </div>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element -- Storage URL with a token */}
                  {p.imageUrl && <figure className="mt-2"><img src={p.imageUrl} alt={p.imageCaption || ""} className="max-h-32 rounded border" />{p.imageCaption && <figcaption className="font-sans text-xs text-neutral-500">{p.imageCaption}</figcaption>}</figure>}
                  <p className="mt-1.5 font-sans text-[11px] text-neutral-500">[{partMarks(p, i, qFormat, bank.marks)} M] {p.cos.join(", ") || "No CO"} · {p.bloom || "No level"}</p>
                </div>
              ))}
            </div>
          </div>

          <div className={cn("rounded-2xl border p-4 shadow-sm", Object.keys(liveErrors).length === 0 ? "border-emerald-300/70 bg-emerald-50/60" : "bg-card")}>
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><ListChecks className="h-3.5 w-3.5" />To save as complete</p>
            {Object.keys(liveErrors).length === 0
              ? <p className="flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />Ready - the server also checks for duplicates</p>
              : <ul className="space-y-2 text-xs">{Object.entries(liveErrors).map(([k, v]) => <li key={k} className="flex gap-2"><span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive"><X className="h-2.5 w-2.5" /></span>{v}</li>)}</ul>}
          </div>
        </aside>
      </div>
    </div>
  );
}
