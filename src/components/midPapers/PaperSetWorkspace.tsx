"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, CircleDashed, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { BLOOM_LEVELS } from "@/lib/midBank/constants";
import { outcomeSwitches } from "@/lib/midBank/outcomeSwitches";
import { choiceText, paperQuestionErrors, partMax, patternMax, questionId } from "@/lib/midPapers/pattern";
import { MathText, QuestionTextField } from "@/components/midBank/MathText";
import { ApprovalPanel } from "@/components/midBank/ApprovalPanel";
import type { MidBankDetail } from "@/lib/midBank/clientTypes";
import type { BloomLevel, MidPaperQuestion, MidQuestionBank, PaperPartDef, PaperSubPart } from "@/types";

// A faculty member's question papers: one tab per set, the questions of each part down the left, the editor for
// the selected question in the middle (its kind decides the fields - options for "choose the correct answer", the
// answer for a blank, parts (a), (b) for descriptive), COs / Bloom only when the college uses them. Drafts
// autosave (one request at a time, never overwriting a newer copy - 409); "Save question" runs the checks.

const AUTOSAVE_MS = 1500;
type Editable = Pick<MidPaperQuestion, "text" | "imageUrl" | "imageCaption" | "options" | "answer" | "subParts" | "cos" | "bloom" | "unit">;
const blank = (part: PaperPartDef): Editable => ({
  text: "", cos: [], bloom: "", ...(part.kind === "MCQ" ? { options: Array.from({ length: part.options ?? 4 }, () => ""), answer: "" } : {}),
  ...(part.kind === "FILL_BLANK" ? { answer: "" } : {}),
});

export function PaperSetWorkspace({ detail }: { detail: MidBankDetail }) {
  const [bank, setBank] = useState<MidQuestionBank>(detail.bank);
  const pattern = bank.pattern!;
  const sw = outcomeSwitches(bank.outcomes);
  const cos = detail.outcomes?.cos ?? [];
  const units = detail.outcomes?.units ?? [];
  const [questions, setQuestions] = useState<Record<string, MidPaperQuestion>>(() =>
    Object.fromEntries((detail.questions as unknown as MidPaperQuestion[]).map((q) => [q.id, q])));
  const [set, setSet] = useState(1);
  const [cur, setCur] = useState<{ partId: string; no: number }>({ partId: pattern.parts[0].id, no: 1 });
  const part = pattern.parts.find((p) => p.id === cur.partId)!;
  const qid = questionId(set, cur.partId, cur.no);
  const [q, setQ] = useState<Editable>(() => questions[qid] ?? blank(part));
  const [rev, setRev] = useState(questions[qid]?.rev ?? 0);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed" | "conflict">("idle");
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const latest = useRef({ qid, q, rev, dirty });
  // What a save sends: always the current question (kept after each render).
  useEffect(() => { latest.current = { qid, q, rev, dirty }; });

  const live = useMemo(() => paperQuestionErrors(q, part, sw), [q, part, sw]);

  const edit = (patch: Partial<Editable>) => { setQ((x) => ({ ...x, ...patch })); setDirty(true); setSaveState((s) => (s === "saved" ? "idle" : s)); };

  const save = useCallback(async (action: "draft" | "complete"): Promise<boolean> => {
    async function send(): Promise<boolean> {
      const sent = { ...latest.current };
      setSaveState("saving");
      try {
        const res = await fetch(`/api/college/mid-question-banks/${encodeURIComponent(bank.id)}/paper-questions/${sent.qid}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, question: sent.q, baseRev: sent.rev }),
        });
        const data = (await res.json()) as { error?: string; errors?: string[]; warnings?: string[]; question?: MidPaperQuestion | null; progress?: { setProgress: MidQuestionBank["setProgress"]; completeCount: number; totalCount: number; allComplete: boolean } };
        if (res.status === 409 && data.question !== undefined && !data.errors) { setSaveState("conflict"); return false; }
        if (!res.ok) {
          setSaveState(res.status >= 500 ? "failed" : "idle");
          if (data.errors) setErrors(data.errors);
          toast({ variant: "destructive", title: data.error ?? "Could not save" });
          return false;
        }
        setQuestions((qs) => { const n = { ...qs }; if (data.question) n[sent.qid] = data.question; else delete n[sent.qid]; return n; });
        if (data.progress) setBank((b) => ({ ...b, setProgress: data.progress!.setProgress, completeCount: data.progress!.completeCount, totalCount: data.progress!.totalCount, status: data.progress!.allComplete ? "COMPLETE" : "IN_PROGRESS" }));
        if (latest.current.qid === sent.qid) { setRev(data.question?.rev ?? 0); setErrors([]); setWarnings(data.warnings ?? []); if (latest.current.q === sent.q) setDirty(false); }
        setSaveState("saved");
        return true;
      } catch { setSaveState("failed"); return false; }
    }
    while (inFlight.current) await inFlight.current;
    const run = send();
    inFlight.current = run;
    try { return await run; } finally { if (inFlight.current === run) inFlight.current = null; }
  }, [bank.id]);

  const isComplete = questions[qid]?.state === "COMPLETE";
  useEffect(() => {
    if (!dirty || isComplete || saveState === "conflict" || saveState === "saving") return;
    const t = setTimeout(() => { void save("draft"); }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [dirty, q, isComplete, saveState, save]);

  function open(nextSet: number, partId: string, no: number) {
    const p = pattern.parts.find((x) => x.id === partId)!;
    const id = questionId(nextSet, partId, no);
    setSet(nextSet); setCur({ partId, no });
    setQ(questions[id] ?? blank(p)); setRev(questions[id]?.rev ?? 0);
    setDirty(false); setErrors([]); setWarnings([]); setSaveState("idle");
  }
  async function go(nextSet: number, partId: string, no: number) {
    if (nextSet === set && partId === cur.partId && no === cur.no) return;
    if (dirty && !(await save(isComplete ? "complete" : "draft"))) return;
    open(nextSet, partId, no);
  }
  function nextSlot(): [number, string, number] | null {
    if (cur.no < part.questions) return [set, cur.partId, cur.no + 1];
    const i = pattern.parts.findIndex((p) => p.id === cur.partId);
    return pattern.parts[i + 1] ? [set, pattern.parts[i + 1].id, 1] : null;
  }
  async function saveQuestion(andNext: boolean) {
    if (!(await save("complete"))) return;
    toast({ variant: "success", title: `Set ${set} · ${part.label} Q${cur.no} saved` });
    if (andNext) { const n = nextSlot(); if (n) open(...n); }
  }

  async function upload(file: File, sub?: number) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("bankId", bank.id);
      form.append("file", file);
      const res = await fetch("/api/upload/mid-question-image", { method: "POST", body: form });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed");
      if (sub === undefined) edit({ imageUrl: data.url });
      else edit({ subParts: (q.subParts ?? []).map((s, i) => (i === sub ? { ...s, imageUrl: data.url } : s)) });
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Upload failed" }); }
    finally { setUploading(false); }
  }

  const split = (q.subParts?.length ?? 0) > 1;
  const setSub = (i: number, patch: Partial<PaperSubPart>) => edit({ subParts: (q.subParts ?? []).map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const stateOf = (id: string) => questions[id]?.state;
  const progress = bank.setProgress?.[String(set)];

  return (
    <div className="space-y-4">
      <ApprovalPanel bank={bank} isOwner isHod={false} onChanged={() => window.location.reload()} />

      <div className="flex flex-wrap items-center gap-2">
        {Array.from({ length: pattern.setsPerFaculty }, (_, i) => i + 1).map((n) => {
          const p = bank.setProgress?.[String(n)];
          const done = p && p.complete >= p.total;
          return (
            <button key={n} type="button" onClick={() => void go(n, pattern.parts[0].id, 1)}
              className={cn("inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium", n === set ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:border-primary/50")}>
              {done ? <CheckCircle2 className="h-4 w-4" /> : null}Question paper {n} <span className="opacity-80">{p ? `${p.complete}/${p.total}` : ""}</span>
            </button>
          );
        })}
        <span className="ml-auto text-sm text-muted-foreground">{patternMax(pattern)} marks · {pattern.durationMinutes} min · {bank.completeCount}/{bank.totalCount} questions done</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)_18rem]">
        {/* Questions of this set */}
        <nav aria-label={`Questions of question paper ${set}`} className="space-y-3 rounded-2xl border bg-card p-3 shadow-sm">
          {pattern.parts.map((p) => (
            <div key={p.id}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{p.label} · {p.title}</p>
              <p className="mb-1.5 text-[11px] text-muted-foreground">{p.questions} x {p.marksEach} = {partMax(p)} marks · {choiceText(p)}</p>
              <div className="grid grid-cols-5 gap-1.5">
                {Array.from({ length: p.questions }, (_, i) => i + 1).map((no) => {
                  const id = questionId(set, p.id, no);
                  const st = stateOf(id);
                  const on = p.id === cur.partId && no === cur.no;
                  return (
                    <button key={no} type="button" onClick={() => void go(set, p.id, no)} aria-current={on ? "true" : undefined}
                      className={cn("h-9 rounded-lg border text-sm font-semibold", on && "ring-2 ring-primary", st === "COMPLETE" ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : st === "DRAFT" ? "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" : "bg-background")}>
                      {no}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {progress && <p className="border-t pt-2 text-xs text-muted-foreground">This paper: {progress.complete}/{progress.total} complete</p>}
        </nav>

        {/* Editor */}
        <section className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Paper {set} · {part.label} · Question {cur.no} <span className="text-sm font-normal text-muted-foreground">({part.marksEach} marks)</span></h2>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {saveState === "saving" && <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving</>}
              {saveState === "saved" && <><Check className="h-3.5 w-3.5 text-emerald-600" />Saved</>}
              {saveState === "failed" && <span className="text-destructive">Not saved - check the connection</span>}
              {saveState === "conflict" && <span className="text-destructive">Changed in another tab - reload the page</span>}
              {isComplete ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">Complete</span> : questions[qid] ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">Draft</span> : <span className="rounded-full bg-muted px-2 py-0.5"><CircleDashed className="inline h-3 w-3" /> Empty</span>}
            </span>
          </div>

          {!split && (
            <div className="space-y-1.5">
              <Label htmlFor="pq-text">{part.kind === "FILL_BLANK" ? "Sentence (mark the blank with ____)" : "Question"}</Label>
              <QuestionTextField id="pq-text" value={q.text} onChange={(v) => edit({ text: v })} placeholder={part.kind === "FILL_BLANK" ? "Water boils at ____ °C at sea level." : "Type the question"} />
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"><ImagePlus className="h-3.5 w-3.5" />{q.imageUrl ? "Replace image" : "Add image"}
                  <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
                </label>
                {q.imageUrl && <Button size="sm" variant="ghost" onClick={() => edit({ imageUrl: undefined, imageCaption: undefined })}><X className="mr-1 h-3.5 w-3.5" />Remove image</Button>}
              </div>
              {q.imageUrl && <Input placeholder="Caption (optional)" maxLength={150} value={q.imageCaption ?? ""} onChange={(e) => edit({ imageCaption: e.target.value })} />}
            </div>
          )}

          {part.kind === "MCQ" && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Options - tick the correct one</legend>
              {(q.options ?? []).map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="radio" name="pq-answer" aria-label={`Option (${"abcdef"[i]}) is correct`} checked={q.answer === String(i)} onChange={() => edit({ answer: String(i) })} />
                  <span className="w-6 text-sm font-semibold">({"abcdef"[i]})</span>
                  <Input value={o} onChange={(e) => edit({ options: (q.options ?? []).map((x, j) => (j === i ? e.target.value : x)) })} />
                </div>
              ))}
            </fieldset>
          )}
          {part.kind === "FILL_BLANK" && (
            <div className="space-y-1.5 max-w-sm"><Label htmlFor="pq-ans">Answer</Label><Input id="pq-ans" value={q.answer ?? ""} onChange={(e) => edit({ answer: e.target.value })} /></div>
          )}

          {part.kind === "DESCRIPTIVE" && (part.maxSubParts ?? 1) > 1 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant={split ? "outline" : "default"} onClick={() => edit({ subParts: undefined })} disabled={!split}>One question</Button>
                <Button size="sm" variant={split ? "default" : "outline"} onClick={() => !split && edit({ subParts: [{ text: q.text, marks: Math.ceil(part.marksEach / 2) }, { text: "", marks: Math.floor(part.marksEach / 2) }] })}>In parts (a), (b) ...</Button>
              </div>
              {split && (q.subParts ?? []).map((sp, i) => (
                <div key={i} className="space-y-1.5 rounded-lg border p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">Part ({"abcde"[i]})</span>
                    <div className="flex items-center gap-2">
                      <Input className="h-8 w-20" type="number" min={0.5} step={0.5} aria-label={`Marks of part (${"abcde"[i]})`} value={sp.marks} onChange={(e) => setSub(i, { marks: Number(e.target.value) })} /><span className="text-xs text-muted-foreground">marks</span>
                      <Button size="icon" variant="ghost" disabled={(q.subParts ?? []).length <= 2} aria-label="Remove part" onClick={() => edit({ subParts: (q.subParts ?? []).filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                  <QuestionTextField id={`pq-sub-${i}`} value={sp.text} onChange={(v) => setSub(i, { text: v })} placeholder="Type this part" />
                </div>
              ))}
              {split && (q.subParts ?? []).length < (part.maxSubParts ?? 1) && (
                <Button size="sm" variant="outline" onClick={() => edit({ subParts: [...(q.subParts ?? []), { text: "", marks: 0 }] })}><Plus className="mr-1 h-4 w-4" />Add part</Button>
              )}
            </div>
          )}

          {(units.length > 0 || sw.cos || sw.bloom) && (
            <div className="grid gap-4 md:grid-cols-3">
              {units.length > 0 && (
                <div className="space-y-1.5"><Label htmlFor="pq-unit">Unit (optional)</Label>
                  <select id="pq-unit" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={q.unit ?? ""} onChange={(e) => edit({ unit: e.target.value ? Number(e.target.value) : undefined })}>
                    <option value="">-</option>
                    {units.map((u) => <option key={u.no} value={u.no}>Unit {u.no} - {u.title}</option>)}
                  </select>
                </div>
              )}
              {sw.cos && (
                <div className="space-y-1.5"><span className="text-sm font-medium">Course Outcome(s)</span>
                  <div className="flex flex-wrap gap-1.5">
                    {cos.map((c) => {
                      const on = q.cos.includes(c.id);
                      return <button key={c.id} type="button" aria-pressed={on} title={c.statement} onClick={() => edit({ cos: on ? q.cos.filter((x) => x !== c.id) : [...q.cos, c.id] })}
                        className={cn("h-8 rounded-full border px-3 text-xs font-semibold", on ? "border-primary bg-primary text-primary-foreground" : "bg-background")}>{c.id}</button>;
                    })}
                  </div>
                </div>
              )}
              {sw.bloom && (
                <fieldset className="space-y-1.5"><legend className="text-sm font-medium">Bloom&rsquo;s level</legend>
                  <div className="flex gap-1.5">
                    {BLOOM_LEVELS.map((l) => (
                      <button key={l} type="button" aria-pressed={q.bloom === l} onClick={() => edit({ bloom: l as BloomLevel })}
                        className={cn("h-8 rounded-lg border px-3 text-sm font-semibold", q.bloom === l ? "border-primary bg-primary text-primary-foreground" : "bg-background")}>{l}</button>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>
          )}

          {(errors.length > 0 || warnings.length > 0) && (
            <ul className="space-y-1 text-sm">
              {errors.map((e) => <li key={e} className="text-destructive">{e}</li>)}
              {warnings.map((w) => <li key={w} className="text-amber-700">{w}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => void save("draft")} disabled={!dirty}>Save draft</Button>
            <Button variant="outline" onClick={() => void saveQuestion(false)}>Save question</Button>
            <Button onClick={() => void saveQuestion(true)}>Save &amp; next</Button>
          </div>
        </section>

        {/* Preview + what's missing */}
        <aside className="space-y-4">
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Still needed</p>
            {live.length === 0 ? <p className="text-sm text-emerald-700">Ready to save</p> : <ul className="space-y-1 text-xs text-muted-foreground">{live.map((e) => <li key={e}>• {e}</li>)}</ul>}
          </div>
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
            <div className="space-y-2 rounded-xl border bg-white p-3 font-serif text-[15px] text-neutral-900 [overflow-wrap:anywhere]">
              {split ? (q.subParts ?? []).map((sp, i) => (
                <div key={i} className="flex gap-1.5"><b>({"abcde"[i]})</b><div className="flex-1"><MathText text={sp.text} /></div><span className="text-xs">[{sp.marks}]</span></div>
              )) : <MathText text={q.text} />}
              {q.imageUrl && <img src={q.imageUrl} alt="" className="max-h-40" />}
              {part.kind === "MCQ" && <ol className="grid grid-cols-2 gap-x-3 text-sm">{(q.options ?? []).map((o, i) => <li key={i}>({"abcdef"[i]}) <MathText text={o} /></li>)}</ol>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
