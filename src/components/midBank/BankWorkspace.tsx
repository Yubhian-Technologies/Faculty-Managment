"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Cloud, CloudOff, ImagePlus, Loader2, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { BLOOM_LABELS, BLOOM_LEVELS, PROGRAM_OUTCOMES, QUESTIONS_PER_UNIT } from "@/lib/midBank/constants";
import { derivePoPso } from "@/lib/midBank/outcomes";
import { bloomNeeds, lockReason } from "@/lib/midBank/rules";
import { defaultSplit, formatOf, isBlankPart, partLabel, partMarks, questionErrors, questionFormat } from "@/lib/midBank/validateQuestion";
import type { MidBankDetail } from "@/lib/midBank/clientTypes";
import type { BloomLevel, MidQuestion, MidQuestionBank, MidQuestionFormat, MidQuestionPart, MidUnitStatus } from "@/types";
import { FormulaTextarea, MathText } from "./MathText";

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

function slotState(q: MidQuestion | undefined, attention: boolean): { label: string; cls: string } {
  if (attention) return { label: "Needs attention", cls: "border-destructive bg-destructive/10 text-destructive" };
  if (!q) return { label: "Empty", cls: "border-dashed text-muted-foreground" };
  if (q.state === "COMPLETE") return { label: "Complete", cls: "border-green-600/50 bg-green-600/10 text-green-800 dark:text-green-300" };
  return { label: "Draft", cls: "border-amber-500/60 bg-amber-500/10 text-amber-800 dark:text-amber-300" };
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
  // A bank that allows EITHER lets each question pick; a new question starts as one question.
  const defaultFormat = questionFormat(bank.format);
  const fmtOf = (q: MidQuestion | undefined | null): MidQuestionFormat => (q ? formatOf(q, bank.format) : defaultFormat);
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

  // Serialise saves: one request at a time, edits made meanwhile are saved after it.
  const inFlight = useRef<Promise<boolean> | null>(null);
  const editSeq = useRef(0);
  const latest = useRef({ parts, rev, qid, dirty, qFormat });
  useEffect(() => { latest.current = { parts, rev, qid, dirty, qFormat }; }, [parts, rev, qid, dirty, qFormat]);

  const current = questions[qid];
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
    // The copy keeps its format where the bank allows either; otherwise it is fitted to the bank's.
    const f = bank.format === "EITHER" ? fmtOf(src) : bank.format;
    const blank = emptyParts(f, bank.marks);
    setQFormat(f);
    setParts(blank.map((b, i) => (src.parts[i] ? { ...src.parts[i], cos: [...src.parts[i].cos], marks: f === "SINGLE" ? bank.marks : src.parts[i].marks ?? b.marks } : b)));
    setDirty(true);
    toast({ title: `Copied Unit ${src.unit} Q${src.slot}`, description: "Edit it - an identical question can't be saved as complete." });
  }

  const liveErrors = useMemo(() => questionErrors(parts, qFormat, bank.marks), [parts, qFormat, bank.marks]);

  /** Switch this question between one question and parts (a) + (b). Part (b) must be empty to drop it. */
  function changeFormat(f: MidQuestionFormat) {
    if (f === qFormat) return;
    if (f === "SINGLE" && parts[1] && !isBlankPart(parts[1])) {
      toast({ variant: "destructive", title: "Clear part (b) first", description: "Its text, COs and level would be lost." });
      return;
    }
    const split = defaultSplit(f, bank.marks);
    editSeq.current++;
    setParts(f === "SINGLE" ? [{ ...parts[0], marks: bank.marks }] : [{ ...parts[0], marks: split[0] }, { text: "", cos: [], bloom: "", marks: split[1] }]);
    setQFormat(f);
    setDirty(true);
  }
  const allCos = [...new Set(parts.flatMap((p) => p.cos))];
  const poPso = derivePoPso(allCos, outcomes.mapping);
  const lockedHere = lockReason(bank.units, bank.unitStatus, cur.unit);
  const others = Object.values(questions).filter((q) => q.id !== qid && q.parts.some((p) => p.text.trim())).sort((a, b) => a.unit - b.unit || a.slot - b.slot);
  const pct = bank.totalCount ? Math.round((bank.completeCount / bank.totalCount) * 100) : 0;

  const saveBadge = {
    idle: dirty ? <span className="text-muted-foreground">{isComplete ? "Unsaved changes - press Save question" : "Unsaved changes"}</span> : null,
    saving: <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</span>,
    saved: <span className="flex items-center gap-1 text-green-700 dark:text-green-400"><Cloud className="h-3.5 w-3.5" />Saved</span>,
    failed: <span className="flex items-center gap-1 text-destructive"><CloudOff className="h-3.5 w-3.5" />Save failed <button type="button" className="underline" onClick={() => void save(isComplete ? "complete" : "draft")}>Retry</button></span>,
    conflict: null,
  }[saveState];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex justify-between text-xs"><span>{bank.completeCount} of {bank.totalCount} questions complete</span><span className="font-medium">{pct}%</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Bank progress">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/panel/mid-bank/${encodeURIComponent(bank.id)}/review`}><ClipboardCheck className="mr-1.5 h-4 w-4" />Review bank</Link>
        </Button>
      </div>

      {/* Below lg the three panels become tabs. */}
      <div className="flex gap-1 rounded-md border p-1 lg:hidden" role="tablist" aria-label="Workspace panels">
        {(["nav", "editor", "info"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}
            className={cn("flex-1 rounded px-3 py-1.5 text-sm", tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
            {t === "nav" ? "Questions" : t === "editor" ? "Editor" : "Details"}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)_300px]">
        {/* Left: units and slots */}
        <nav aria-label="Units and questions" className={cn("space-y-4", tab !== "nav" && "hidden lg:block")}>
          {bank.units.map((u) => {
            const st = bank.unitStatus[String(u)];
            const reason = lockReason(bank.units, bank.unitStatus, u);
            return (
              <section key={u} className="rounded-lg border p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Unit {u}</p>
                    <p className="truncate text-xs text-muted-foreground" title={unitTitle(u)}>{unitTitle(u)}</p>
                  </div>
                  {st?.complete ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-label="Unit complete" /> : <span className="text-xs text-muted-foreground">{st?.completeCount ?? 0}/{QUESTIONS_PER_UNIT}</span>}
                </div>
                {reason ? (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" />{reason}</p>
                ) : (
                  <div className="grid grid-cols-5 gap-1.5">
                    {Array.from({ length: QUESTIONS_PER_UNIT }, (_, i) => i + 1).map((s) => {
                      const id = qidOf(u, s);
                      const state = slotState(questions[id], attention.has(id));
                      const active = u === cur.unit && s === cur.slot;
                      return (
                        <button key={s} type="button" onClick={() => void go(u, s)} aria-current={active ? "true" : undefined}
                          aria-label={`Unit ${u} question ${s}: ${state.label}`} title={state.label}
                          className={cn("h-8 rounded border text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", state.cls, active && "ring-2 ring-primary ring-offset-1")}>
                          {s}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
          <p className="text-xs text-muted-foreground">Grey dashed = empty, amber = draft, green = complete, red = needs attention.</p>
        </nav>

        {/* Centre: editor */}
        <section aria-label="Question editor" className={cn("space-y-4", tab !== "editor" && "hidden lg:block")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Unit {cur.unit} · Question {cur.slot}</h2>
            <div className="flex items-center gap-3 text-xs">
              {saveBadge}
              <Badge variant={isComplete ? "default" : current ? "secondary" : "outline"}>{isComplete ? "Complete" : current ? "Draft" : "Empty"}</Badge>
            </div>
          </div>

          {saveState === "conflict" && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm dark:bg-amber-950/30" role="alert">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              <span className="flex-1">This question was changed in another tab or window. Your edits here were not saved.</span>
              <Button size="sm" variant="outline" onClick={() => {
                if (conflict) setQuestions((qs) => ({ ...qs, [qid]: conflict })); else setQuestions((qs) => { const n = { ...qs }; delete n[qid]; return n; });
                setQFormat(fmtOf(conflict)); setParts(conflict?.parts ?? emptyParts(fmtOf(conflict), bank.marks)); setRev(conflict?.rev ?? 0); setDirty(false); setConflict(null); setSaveState("idle");
              }}>Load the saved version</Button>
            </div>
          )}

          {lockedHere && <p className="text-sm text-muted-foreground"><Lock className="mr-1 inline h-4 w-4" />{lockedHere}</p>}

          {others.length > 0 && !lockedHere && (
            <div className="flex items-center gap-2">
              <Label htmlFor="copy-from" className="shrink-0 text-xs text-muted-foreground">Start from a copy of</Label>
              <select id="copy-from" className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs" value="" onChange={(e) => { if (e.target.value) copyFrom(e.target.value); }}>
                <option value="">Choose a question…</option>
                {others.map((q) => <option key={q.id} value={q.id}>Unit {q.unit} Q{q.slot}: {q.parts[0]?.text.slice(0, 70)}</option>)}
              </select>
            </div>
          )}

          {bank.format === "EITHER" && !lockedHere && (
            <fieldset className="flex flex-wrap items-center gap-4 text-sm">
              <legend className="sr-only">Question format</legend>
              {(["SINGLE", "PARTS_AB"] as MidQuestionFormat[]).map((f) => (
                <label key={f} className="flex items-center gap-1.5">
                  <input type="radio" name="q-format" checked={qFormat === f} onChange={() => changeFormat(f)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                  {f === "SINGLE" ? `One question (${bank.marks} marks)` : "Parts (a) and (b)"}
                </label>
              ))}
            </fieldset>
          )}
          {qFormat === "PARTS_AB" && (fieldErrors.marks || (dirty && liveErrors.marks)) && (
            <p className="text-xs text-destructive">{fieldErrors.marks || liveErrors.marks}</p>
          )}

          {parts.map((p, i) => {
            const pre = `p${i}`;
            const err = (f: string) => fieldErrors[`parts.${i}.${f}`];
            return (
              <fieldset key={i} disabled={Boolean(lockedHere)} className="space-y-3 rounded-lg border p-4">
                <legend className="px-1 text-sm font-semibold">
                  {partLabel(qFormat, i)}{" "}
                  {qFormat === "SINGLE" ? <span className="font-normal text-muted-foreground">· {bank.marks} marks</span> : (
                    <span className="font-normal text-muted-foreground">
                      ·{" "}
                      <input type="number" min={1} max={bank.marks - 1} aria-label={`Marks for ${partLabel(qFormat, i)}`}
                        value={p.marks ?? ""} onChange={(e) => edit(i, { marks: e.target.value === "" ? 0 : Number(e.target.value) })}
                        className="h-7 w-14 rounded border border-input bg-background px-1 text-center text-sm" /> marks
                    </span>
                  )}
                </legend>

                <div className="space-y-1.5">
                  <Label htmlFor={`${pre}-text`}>Question text</Label>
                  <FormulaTextarea id={`${pre}-text`} value={p.text} onChange={(v) => edit(i, { text: v })} invalid={Boolean(err("text"))} describedBy={err("text") ? `${pre}-text-err` : undefined}
                    placeholder="Write the question. Put formulas between $ signs, e.g. Find $\\int_0^1 x^2 dx$." />
                  {err("text") && <p id={`${pre}-text-err`} className="text-xs text-destructive">{err("text")}</p>}
                </div>

                <div className="space-y-1.5">
                  <span className="text-sm font-medium">Image (optional)</span>
                  {p.imageUrl ? (
                    <div className="flex flex-wrap items-start gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element -- Storage URL with a token, not an optimisable asset */}
                      <img src={p.imageUrl} alt={p.imageCaption || `Image for ${partLabel(qFormat, i)}`} className="max-h-40 rounded border" />
                      <div className="flex flex-col gap-2">
                        <label className="inline-flex cursor-pointer items-center text-xs underline">
                          Replace<input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(i, f); e.target.value = ""; }} />
                        </label>
                        <button type="button" className="text-left text-xs text-destructive underline" onClick={() => edit(i, { imageUrl: undefined, imageCaption: undefined })}>Remove</button>
                      </div>
                    </div>
                  ) : (
                    <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring">
                      {uploading === i ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                      {uploading === i ? "Uploading…" : "Add image (PNG or JPEG, up to 1 MB)"}
                      <input type="file" accept="image/png,image/jpeg" className="sr-only" disabled={uploading !== null} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(i, f); e.target.value = ""; }} />
                    </label>
                  )}
                  {p.imageUrl && (
                    <Input aria-label="Image caption" placeholder="Caption (optional, up to 150 characters)" maxLength={150} value={p.imageCaption ?? ""} onChange={(e) => edit(i, { imageCaption: e.target.value })} />
                  )}
                  {err("imageCaption") && <p className="text-xs text-destructive">{err("imageCaption")}</p>}
                </div>

                <div className="space-y-1.5">
                  <span className="text-sm font-medium" id={`${pre}-co-label`}>Course Outcome(s)</span>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`${pre}-co-label`}>
                    {outcomes.cos.map((c) => {
                      const on = p.cos.includes(c.id);
                      return (
                        <button key={c.id} type="button" aria-pressed={on} title={c.statement}
                          onClick={() => edit(i, { cos: on ? p.cos.filter((x) => x !== c.id) : [...p.cos, c.id] })}
                          className={cn("rounded-full border px-3 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                          {c.id}
                        </button>
                      );
                    })}
                  </div>
                  {err("cos") && <p className="text-xs text-destructive">{err("cos")}</p>}
                </div>

                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium">Bloom&rsquo;s level</legend>
                  <div className="flex flex-wrap gap-3">
                    {BLOOM_LEVELS.map((l) => (
                      <label key={l} className="flex items-center gap-1.5 text-sm">
                        <input type="radio" name={`${pre}-bloom`} value={l} checked={p.bloom === l} onChange={() => edit(i, { bloom: l as BloomLevel })} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                        {BLOOM_LABELS[l]}
                      </label>
                    ))}
                  </div>
                  {err("bloom") && <p className="text-xs text-destructive">{err("bloom")}</p>}
                </fieldset>
              </fieldset>
            );
          })}

          {warnings.length > 0 && (
            <ul className="space-y-1 rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              {warnings.map((w) => <li key={w}>{w} - check it isn&rsquo;t a repeat.</li>)}
            </ul>
          )}

          {!lockedHere && (
            <div className="flex flex-wrap justify-end gap-2">
              {!isComplete && <Button variant="outline" onClick={() => void save("draft")} disabled={!dirty || saveState === "saving"}>Save draft</Button>}
              <Button variant="outline" onClick={() => void saveQuestion(false)} disabled={saveState === "saving" || parts.every(isBlankPart)}>Save question</Button>
              <Button onClick={() => void saveQuestion(true)} disabled={saveState === "saving" || parts.every(isBlankPart)}>Save &amp; next</Button>
            </div>
          )}
        </section>

        {/* Right: academic details */}
        <aside aria-label="Question details" className={cn("space-y-4 text-sm", tab !== "info" && "hidden lg:block")}>
          <div className="rounded-lg border p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Unit {cur.unit} Bloom&rsquo;s levels</p>
            <ul className="space-y-1">
              {bloomNeeds(unitStatus.bloom).map((b) => (
                <li key={b.level} className="flex justify-between">
                  <span>{b.level}: {b.count}</span>
                  <span className={b.need ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400"}>{b.need ? `Need ${b.need} more` : "Complete"}</span>
                </li>
              ))}
              <li className="flex justify-between border-t pt-1"><span>Questions</span><span>{unitStatus.completeCount}/{QUESTIONS_PER_UNIT} complete{unitStatus.draftCount ? `, ${unitStatus.draftCount} draft` : ""}</span></li>
            </ul>
          </div>

          <div className="rounded-lg border p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Outcomes</p>
            {allCos.length === 0 ? <p className="text-xs text-muted-foreground">Pick a Course Outcome to see its POs and PSOs.</p> : (
              <>
                <ul className="mb-2 space-y-1">{allCos.map((c) => <li key={c}><span className="font-medium">{c}</span> {outcomes.cos.find((x) => x.id === c)?.statement}</li>)}</ul>
                <div className="flex flex-wrap gap-1">
                  {poPso.map((x) => <Badge key={x.id} variant="outline" title={PROGRAM_OUTCOMES.find((p) => p.id === x.id)?.title ?? outcomes.psos.find((p) => p.id === x.id)?.statement}>{x.id} ({x.level})</Badge>)}
                </div>
              </>
            )}
          </div>

          <div className="rounded-lg border p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Preview</p>
            <div className="space-y-3">
              {parts.map((p, i) => (
                <div key={i}>
                  {qFormat === "PARTS_AB" && <span className="mr-1 font-medium">({i === 0 ? "a" : "b"})</span>}
                  {p.text.trim() ? <MathText text={p.text} className="inline" /> : <span className="text-muted-foreground">Nothing written yet</span>}
                  {/* eslint-disable-next-line @next/next/no-img-element -- Storage URL with a token */}
                  {p.imageUrl && <figure className="mt-2"><img src={p.imageUrl} alt={p.imageCaption || ""} className="max-h-32 rounded border" />{p.imageCaption && <figcaption className="text-xs text-muted-foreground">{p.imageCaption}</figcaption>}</figure>}
                  <p className="mt-1 text-xs text-muted-foreground">[{partMarks(p, i, qFormat, bank.marks)} M] {p.cos.join(", ") || "No CO"} · {p.bloom || "No level"}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">To save as complete</p>
            {Object.keys(liveErrors).length === 0
              ? <p className="flex items-center gap-1 text-green-700 dark:text-green-400"><CheckCircle2 className="h-4 w-4" />Ready - the server also checks for duplicates</p>
              : <ul className="space-y-1 text-xs">{Object.entries(liveErrors).map(([k, v]) => <li key={k} className="flex gap-1"><X className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />{v}</li>)}</ul>}
          </div>
        </aside>
      </div>
    </div>
  );
}
