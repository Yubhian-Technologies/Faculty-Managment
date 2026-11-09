"use client";

import { useState } from "react";
import Link from "next/link";
import { FileDown, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";
import { outcomeSwitches } from "@/lib/midBank/outcomeSwitches";
import { choiceText, flexibleQuestions, partFor, partMax, patternMax, setNumbers } from "@/lib/midPapers/pattern";
import { downloadMidPaperSetPdf } from "@/lib/pdf/downloadMidPaperSet";
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
  const progress = bank.setProgress?.[String(set)];
  const complete = !!progress && progress.complete >= progress.total && !(progress.problems?.length);

  async function pdf() {
    setBusy(true);
    try {
      await downloadMidPaperSetPdf(paperSetData(detail, set), `MID${bank.midNumber}_${bank.subjectCode}_${detail.branchLabel?.branch ?? bank.branch}_paper-${set}`);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't build the PDF" });
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <ApprovalPanel bank={bank} isOwner={detail.access.isOwner} isHod={!!detail.access.isHod} onChanged={onChanged} />
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
          {detail.access.canDownload && <Button size="sm" onClick={() => void pdf()} loading={busy} disabled={!complete} title={complete ? "" : "Complete every question of this paper first"}><FileDown className="mr-1.5 h-4 w-4" />PDF of paper {set}</Button>}
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
