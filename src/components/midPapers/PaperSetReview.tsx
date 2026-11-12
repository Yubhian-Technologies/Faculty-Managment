"use client";

import { useState } from "react";
import Link from "next/link";
import { FileDown, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";
import { outcomeSwitches } from "@/lib/midBank/outcomeSwitches";
import { choiceText, flexibleQuestions, partFor, partMax, patternMax, setNumbers } from "@/lib/midPapers/pattern";
import { downloadMidPaperSetPartsPdf, downloadMidPaperSetPdf } from "@/lib/pdf/downloadMidPaperSet";
import { defaultPartHeaders } from "@/lib/midPapers/printLayout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PaperPreviewButton, paperSetData } from "@/components/midPapers/PaperPreview";
import { MathText } from "@/components/midBank/MathText";
import { ApprovalPanel } from "@/components/midBank/ApprovalPanel";
import { SuggestionsPanel } from "@/components/midBank/SuggestionsPanel";
import type { MidBankDetail } from "@/lib/midBank/clientTypes";
import type { MidPaperQuestion } from "@/types";

// A faculty member's question papers, read-only: each paper laid out as it will print (answers shown to those
// allowed to see them), the HOD approval strip, and each paper's PDF once it is complete. Opening it writes nothing.

const LETTERS = "abcdef";

export function PaperSetReview({ detail, writeHref, onChanged }: { detail: MidBankDetail; writeHref?: string; onChanged: () => void }) {
  const { bank } = detail;
  const pattern = bank.pattern!;
  const sw = outcomeSwitches(bank.outcomes);
  const questions = detail.questions as unknown as MidPaperQuestion[];
  const byId = new Map(questions.map((q) => [q.id, q]));
  const mySets = setNumbers(pattern);
  const [set, setSet] = useState(mySets[0] ?? 1);
  const [busy, setBusy] = useState(false);

  const isDone = (n: number) => { const p = bank.setProgress?.[String(n)]; return !!p && p.complete >= p.total && !(p.problems?.length); };
  // Short file name: Mid, subject code, the branch (one branch only - a paper for several branches would make it
  // hundreds of characters), the paper number.
  const fileName = (n: number) => `MID${bank.midNumber}_${bank.subjectCode}${detail.branchLabel && !detail.branchLabel.sections.length ? "" : `_${detail.branchLabel?.branch ?? bank.branch}`}_Paper-${n}`;

  /**
   * Each paper is its own PDF - one file per paper; with `parts`, each PART of it is its own paper too (a file per part,
   * each with the full header and that part's time + max marks).
   */
  async function pdf(which: number[], parts?: { partId: string; durationMinutes: number; maxMarks: number }[]) {
    setBusy(true);
    try {
      const ready = which.filter(isDone);
      for (const n of ready) {
        if (parts) await downloadMidPaperSetPartsPdf(paperSetData(detail, n), parts, fileName(n));
        else await downloadMidPaperSetPdf(paperSetData(detail, n), fileName(n));
      }
      const skipped = which.filter((n) => !ready.includes(n));
      if (skipped.length) toast({ title: `Paper ${skipped.join(", ")} not complete yet - not downloaded` });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't build the PDF" });
    } finally { setBusy(false); }
  }

  const [downloading, setDownloading] = useState(false);
  return (
    <div className="space-y-4">
      {downloading && (
        <DownloadDialog pattern={pattern} current={set} papers={mySets} isDone={isDone} busy={busy}
          onClose={() => setDownloading(false)}
          onDownload={(which, parts) => { setDownloading(false); void pdf(which, parts); }} />
      )}
      <ApprovalPanel bank={bank} isOwner={detail.access.isOwner} isHod={!!detail.access.isHod} onChanged={onChanged} editHref={writeHref && detail.access.canWrite ? writeHref : undefined} />
      <SuggestionsPanel bankId={bank.id} questions={questions.map((q) => ({ id: q.id, label: `Paper ${q.set} · ${pattern.parts.find((p) => p.id === q.partId)?.label ?? q.partId} Q${q.no}` }))} />
      <Card><CardContent className="flex flex-wrap items-center gap-2 p-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{bank.subjectName} ({bank.subjectCode}) · {bank.branch} · Mid {bank.midNumber}</p>
          <p className="text-xs text-muted-foreground">{bank.ownerName} · sections {bank.sections.map((s) => s.sectionName).join(", ")} · {pattern.sets?.length ? `Paper ${mySets.join(", ")} of ${pattern.setsPerFaculty}` : `${pattern.setsPerFaculty} question paper${pattern.setsPerFaculty === 1 ? "" : "s"}`} · {patternMax(pattern)} marks · {bank.completeCount}/{bank.totalCount} questions done</p>
        </div>
        {writeHref && detail.access.canWrite && <Button asChild variant="outline" size="sm"><Link href={writeHref}><Pencil className="mr-1.5 h-4 w-4" />Continue writing</Link></Button>}
      </CardContent></Card>

      <div className="flex flex-wrap items-center gap-2">
        {mySets.map((n) => {
          const p = bank.setProgress?.[String(n)];
          return (
            <button key={n} type="button" onClick={() => setSet(n)} className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${n === set ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>
              Question paper {n} {p ? `· ${p.complete}/${p.total}` : ""}
            </button>
          );
        })}
        {/* Faculty and the HOD preview on screen; only the Exam Cell downloads the PDF. */}
        <div className="ml-auto flex gap-2">
          <PaperPreviewButton detail={detail} initialSet={set} />
          {detail.access.canDownload && (
            <Button size="sm" onClick={() => setDownloading(true)} loading={busy} disabled={!mySets.some(isDone)} title={mySets.some(isDone) ? "" : "Complete a paper first"}>
              <FileDown className="mr-1.5 h-4 w-4" />Download PDF
            </Button>
          )}
        </div>
      </div>

      {(bank.setProgress?.[String(set)]?.problems ?? []).length > 0 && (
        <ul className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{bank.setProgress![String(set)].problems!.map((x) => <li key={x}>{x}</li>)}</ul>
      )}
      <Card><CardContent className="space-y-5 p-5 font-serif text-[15px]">
        {pattern.parts.map((part) => (
          <section key={part.id} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-1 font-sans">
              <h3 className="text-sm font-bold uppercase">{part.label} - {part.title}</h3>
              <span className="text-xs text-muted-foreground">{choiceText(part, part.flexible ? flexibleQuestions(questions, set, part.id).length : undefined)} · {partMax(part)} marks</span>
            </div>
            <ol className="space-y-3">
              {Array.from({ length: part.flexible ? Math.max(1, flexibleQuestions(questions, set, part.id).length) : part.questions }, (_, i) => i + 1).map((no) => {
                const q = byId.get(`${set}_${part.id}_${no}`);
                const kind = partFor(part, q).kind;
                return (
                  <li key={no} className="space-y-1">
                    {part.choice.kind === "OR_PAIRS" && no % 2 === 0 && <p className="text-center font-sans text-xs font-bold">OR</p>}
                    <div className="flex gap-2">
                      <span className="w-7 shrink-0 font-sans font-semibold">{no}.</span>
                      <div className="min-w-0 flex-1 space-y-1">
                        {!q ? <p className="font-sans text-sm italic text-muted-foreground">Not written yet</p> : <>
                          {q.text && <MathText text={q.text} />}
                          {q.imageUrl && <img src={q.imageUrl} alt="" className="max-h-48" />}
                          {q.subParts?.map((sp, j) => <div key={j} className="flex gap-1.5"><b>({LETTERS[j]})</b><div className="flex-1"><MathText text={sp.text} /></div><span className="font-sans text-xs">[{sp.marks}]</span></div>)}
                          {kind === "MCQ" && <ol className="grid grid-cols-2 gap-x-4 text-sm">{(q.options ?? []).map((o, j) => <li key={j} className={q.answer === String(j) ? "font-semibold text-emerald-700" : ""}>({LETTERS[j]}) <MathText text={o} /></li>)}</ol>}
                          {kind === "FILL_BLANK" && q.answer && <p className="font-sans text-xs text-emerald-700">Answer: {q.answer}</p>}
                          <p className="font-sans text-[11px] text-muted-foreground">
                            {[q.state === "COMPLETE" ? "Complete" : "Draft", sw.cos && (q.cos.join(", ") || "No CO"), sw.bloom && (q.bloom || "No level"), q.unit && `Unit ${q.unit}`].filter(Boolean).join(" · ")}
                          </p>
                        </>}
                      </div>
                      <span className="font-sans text-xs text-muted-foreground">[{part.flexible ? q?.marks ?? "-" : part.marksEach}]</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </CardContent></Card>
    </div>
  );
}

/**
 * Exam Cell: which papers to download (this one, or every paper - one file each) and how: all parts on one paper, or
 * each part as its own paper (its own full header, time and max marks - a file per part).
 */
function DownloadDialog({ pattern, current, papers, isDone, busy, onClose, onDownload }: {
  pattern: NonNullable<MidBankDetail["bank"]["pattern"]>; current: number; papers: number[]; isDone: (n: number) => boolean; busy: boolean;
  onClose: () => void; onDownload: (which: number[], parts?: { partId: string; durationMinutes: number; maxMarks: number }[]) => void;
}) {
  const [all, setAll] = useState(false);
  const [separate, setSeparate] = useState(false);
  const [parts, setParts] = useState(() => defaultPartHeaders(pattern.parts, pattern.durationMinutes).map((p) => ({
    ...p, label: pattern.parts.find((x) => x.id === p.partId)?.label ?? p.partId, d: String(p.durationMinutes), m: String(p.maxMarks),
  })));
  const canSplit = pattern.parts.length > 1;
  const which = all ? papers.filter(isDone) : [current];
  const bad = separate && parts.some((p) => !(Number(p.d) >= 1 && Number.isInteger(Number(p.d)) && Number(p.m) >= 1 && Number.isInteger(Number(p.m))));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Download PDF</DialogTitle>
          <DialogDescription>Each paper is its own file. Nothing is finalized here - printing for the exam stays on the Mid Question Paper page.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {papers.length > 1 && (
            <div className="space-y-1.5">
              <p className="font-medium">Papers</p>
              <label className="flex items-center gap-2"><input type="radio" checked={!all} onChange={() => setAll(false)} />Paper {current}{isDone(current) ? "" : " (not complete)"}</label>
              <label className="flex items-center gap-2"><input type="radio" checked={all} onChange={() => setAll(true)} />All complete papers ({papers.filter(isDone).map((n) => `Paper ${n}`).join(", ") || "none yet"})</label>
            </div>
          )}
          <div className="space-y-1.5">
            <p className="font-medium">Layout</p>
            <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={!separate} onChange={() => setSeparate(false)} />
              <span><b>All parts on one paper</b><br /><span className="text-xs text-muted-foreground">One header, then every part.</span></span></label>
            <label className={`flex items-start gap-2 ${canSplit ? "" : "opacity-50"}`}><input type="radio" className="mt-1" disabled={!canSplit} checked={separate} onChange={() => setSeparate(true)} />
              <span><b>Each part as its own paper</b><br /><span className="text-xs text-muted-foreground">{canSplit ? "A file per part, each with its own full header (Regd. No boxes, letterhead), time and max marks." : "This paper has one part."}</span></span></label>
          </div>
          {separate && (
            <div className="space-y-2 rounded-md border p-3">
              {parts.map((p, i) => (
                <div key={p.partId} className="grid grid-cols-[minmax(0,1fr)_6rem_6rem] items-end gap-2">
                  <span className="pb-2 font-medium">{p.label}</span>
                  <div className="space-y-1"><Label htmlFor={`dl-t-${p.partId}`} className="text-xs">Time (min)</Label>
                    <Input id={`dl-t-${p.partId}`} inputMode="numeric" value={p.d} onChange={(e) => setParts((c) => c.map((x, j) => (j === i ? { ...x, d: e.target.value } : x)))} /></div>
                  <div className="space-y-1"><Label htmlFor={`dl-m-${p.partId}`} className="text-xs">Max marks</Label>
                    <Input id={`dl-m-${p.partId}`} inputMode="numeric" value={p.m} onChange={(e) => setParts((c) => c.map((x, j) => (j === i ? { ...x, m: e.target.value } : x)))} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={which.length === 0 || !which.every(isDone) || bad}
            onClick={() => onDownload(which, separate ? parts.map((p) => ({ partId: p.partId, durationMinutes: Number(p.d), maxMarks: Number(p.m) })) : undefined)}>
            <FileDown className="mr-1.5 h-4 w-4" />Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
