"use client";

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { joinPaperHtmls, paperSetHtmls, type PaperSetPdfData } from "@/lib/pdf/midPaperSetTemplate";
import { paperLetterhead } from "@/lib/pdf/downloadMidPaperSet";
import { setNumbers } from "@/lib/midPapers/pattern";
import type { MidBankDetail } from "@/lib/midBank/clientTypes";
import type { MidPaperQuestion } from "@/types";

// A question paper exactly as it prints (letterhead, Regd. No boxes, exam line, the paper's branches + sections,
// every part), on screen only. Faculty preparing it and the HOD reviewing it preview; only the Exam Cell downloads.
// Questions not written yet show as "(not written)".

/** The data a paper set prints from - shared by the preview and the Exam Cell's PDF. */
export function paperSetData(detail: MidBankDetail, set: number): Omit<PaperSetPdfData, "college" | "formula"> {
  const { bank } = detail;
  const label = detail.branchLabel ?? { branch: bank.branch, sections: bank.sections.map((s) => s.sectionName) };
  return {
    exam: { courseName: detail.subject.courseName, year: bank.year, semester: bank.semester, midNumber: bank.midNumber },
    subject: { name: bank.subjectName, code: bank.subjectCode, regulation: detail.subject.regulation },
    branch: label.branch, sections: label.sections, pattern: bank.pattern!, set,
    questions: detail.questions as unknown as MidPaperQuestion[], units: bank.units,
    outcomes: bank.outcomes, cos: detail.outcomes?.cos ?? [], mapping: detail.outcomes?.mapping ?? {},
  };
}

export function PaperPreviewButton({ detail, initialSet = 1, size = "sm" }: { detail: MidBankDetail; initialSet?: number; size?: "sm" | "default" }) {
  const [open, setOpen] = useState(false);
  const [set, setSet] = useState(initialSet);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const sets = detail.bank.pattern ? setNumbers(detail.bank.pattern) : [1];

  useEffect(() => {
    if (!open) return;
    let off = false;
    paperLetterhead()
      .then(({ info, college, formula }) => {
        const data = paperSetData(detail, set);
        if (!off) { setHtml(joinPaperHtmls(paperSetHtmls({ ...data, exam: { academicYear: info.academicYear, ...data.exam }, college, formula }))); setError(""); }
      })
      .catch(() => { if (!off) setError("Unable to build the preview"); });
    return () => { off = true; };
  }, [open, set, detail]);

  return (
    <>
      <Button size={size} variant="outline" onClick={() => { setSet(initialSet); setHtml(""); setOpen(true); }}><Eye className="mr-1.5 h-4 w-4" />Preview paper</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[90vh] max-w-4xl flex-col gap-3">
          <DialogHeader><DialogTitle>Preview - as it prints</DialogTitle></DialogHeader>
          {sets.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {sets.map((n) => (
                <button key={n} type="button" onClick={() => { setHtml(""); setSet(n); }}
                  className={cn("rounded-full border px-3 py-1 text-sm font-medium", n === set ? "border-primary bg-primary text-primary-foreground" : "bg-background")}>Question paper {n}</button>
              ))}
            </div>
          )}
          {error ? <p className="text-sm text-destructive">{error}</p>
            : html ? <iframe title={`Question paper ${set} preview`} srcDoc={html} sandbox="" className="min-h-0 w-full flex-1 rounded-md border bg-white" />
            : <div className="min-h-0 flex-1 animate-pulse rounded-md border bg-muted/30" />}
          <p className="text-xs text-muted-foreground">Preview only - the Exam Cell prints the paper.</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
