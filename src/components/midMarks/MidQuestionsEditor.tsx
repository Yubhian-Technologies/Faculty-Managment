"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { boxLabel, PART_LETTERS } from "@/lib/midMarks/format";
import type { MidFormatComponent, MidSectionQuestion } from "@/types/midMarks";

// Exam Cell > Mid Marks > Set Questions / Questions & COs (Mid exam format colleges): a section's written questions -
// which are split into parts (Q2(A), Q2(B)) - and the CO of every box. The questions lock once marks are entered; COs
// can be set at any time (a box without one is "CO pending"). "Copy to" gives other sections of the subject the same.

interface Loaded {
  subjectCode: string; subjectName: string; sectionName: string; department: string;
  components: MidFormatComponent[]; questions: Record<string, MidSectionQuestion[]>;
  coOptions: { id: string; statement: string }[];
  siblings: { assignmentId: string; sectionName: string; department: string; facultyName: string; hasMarks: boolean; set: boolean }[];
  hasMarks: boolean; coPending: number;
}

const selectClass = "h-8 rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60";

export function MidQuestionsEditor({ assignmentId, midNumber, onClose, onSaved }: { assignmentId: string; midNumber: number; onClose: () => void; onSaved?: () => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Record<string, MidSectionQuestion[]>>({});
  const [copyTo, setCopyTo] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/college/mid-marks-sheets/questions?assignmentId=${encodeURIComponent(assignmentId)}&mid=${midNumber}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "Unable to load the questions."); return d as Loaded; })
      .then((d) => { if (live) { setData(d); setQuestions(d.questions); } })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [assignmentId, midNumber]);

  const setParts = (cid: string, i: number, n: number) => setQuestions((p) => ({
    ...p, [cid]: p[cid].map((q, j) => (j !== i ? q : { ...q, parts: n < 2 ? [] : PART_LETTERS.slice(0, n), cos: Array.from({ length: Math.max(1, n < 2 ? 1 : n) }, (_, k) => q.cos[k] ?? q.cos[0] ?? null) })),
  }));
  const setCo = (cid: string, i: number, k: number, co: string) => setQuestions((p) => ({
    ...p, [cid]: p[cid].map((q, j) => {
      if (j !== i) return q;
      const v = co || null;
      // The first part's CO fills the other parts that have none yet.
      const cos = q.cos.map((x, m) => (m === k ? v : k === 0 && !x ? v : x));
      return { ...q, cos };
    }),
  }));
  const pending = Object.values(questions).reduce((n, qs) => n + qs.reduce((m, q) => m + q.cos.filter((x) => !x).length, 0), 0);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/college/mid-marks-sheets/questions", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId, midNumber, questions, copyTo: [...copyTo] }),
      });
      const d = (await res.json()) as { error?: string; copied?: string[]; skipped?: { section: string; reason: string }[] };
      if (!res.ok) throw new Error(d.error ?? "Unable to save the questions.");
      const skipped = d.skipped ?? [];
      toast({
        variant: skipped.length ? "default" : "success",
        title: `Questions saved${d.copied?.length ? ` and copied to ${d.copied.length} section${d.copied.length === 1 ? "" : "s"}` : ""}.`,
        ...(skipped.length ? { description: `Not copied: ${skipped.map((s) => `${s.section} (${s.reason})`).join("; ")}` } : {}),
      });
      onSaved?.();
      onClose();
    } catch (e) {
      toast({ variant: "destructive", title: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mid-{midNumber} Questions &amp; COs</DialogTitle>
          <DialogDescription>
            {data ? `${data.subjectCode} ${data.subjectName} · ${data.department} · Section ${data.sectionName}. ` : ""}
            Set how each question is split into parts and the CO of every box. A box without a CO shows as CO pending; marks are never held up by it.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!data && !error && <div className="h-40 animate-pulse rounded-lg bg-muted" />}
        {data && (
          <div className="space-y-5">
            {data.hasMarks && <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">Marks are entered, so the questions and their parts can&apos;t change. COs can still be set.</p>}
            {data.components.filter((c) => c.kind === "QUESTIONS").map((c) => (
              <div key={c.id} className="space-y-2">
                <p className="text-sm font-medium">{c.name} <span className="font-normal text-muted-foreground">· {c.questions} questions × {c.marksEach}{c.choice?.kind === "OR_PAIRS" ? " · OR pairs" : c.choice?.kind === "ANY" ? ` · any ${c.choice.answer}` : ""} · out of {c.max}</span></p>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                      <tr><th className="px-3 py-2 font-medium">Question</th><th className="px-3 py-2 font-medium">Parts</th><th className="px-3 py-2 font-medium">CO of Each Box</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {(questions[c.id] ?? []).map((q, i) => (
                        <tr key={q.no} className={cn(c.choice?.kind === "OR_PAIRS" && i % 2 === 1 && "border-t-0")}>
                          <td className="px-3 py-2 font-medium">Q{q.no}{c.choice?.kind === "OR_PAIRS" && i % 2 === 1 && <span className="ml-1 text-xs font-normal text-muted-foreground">(or Q{q.no - 1})</span>}</td>
                          <td className="px-3 py-2">
                            <select className={selectClass} value={q.parts.length} disabled={data.hasMarks} aria-label={`Q${q.no} parts`} onChange={(e) => setParts(c.id, i, Number(e.target.value))}>
                              <option value={0}>No parts</option>
                              {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{PART_LETTERS.slice(0, n).map((l) => `(${l})`).join(" ")}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-2">
                              {(q.parts.length ? q.parts : [undefined]).map((p, k) => (
                                <label key={k} className="flex items-center gap-1 text-xs">
                                  <span className="w-12 text-muted-foreground">{boxLabel(q.no, p)}</span>
                                  <select className={cn(selectClass, !q.cos[k] && "border-amber-400")} value={q.cos[k] ?? ""} aria-label={`${boxLabel(q.no, p)} CO`} onChange={(e) => setCo(c.id, i, k, e.target.value)}>
                                    <option value="">Pending</option>
                                    {data.coOptions.map((o) => <option key={o.id} value={o.id} title={o.statement}>{o.id}</option>)}
                                  </select>
                                </label>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {data.siblings.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Copy to Other Sections</p>
                <p className="text-xs text-muted-foreground">Sections with marks against other questions are skipped; with the same questions they take the COs.</p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {data.siblings.map((s) => (
                    <label key={s.assignmentId} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                      <input type="checkbox" checked={copyTo.has(s.assignmentId)}
                        onChange={(e) => setCopyTo((p) => { const n = new Set(p); if (e.target.checked) n.add(s.assignmentId); else n.delete(s.assignmentId); return n; })} />
                      <span className="font-medium">{s.department} · {s.sectionName}</span>
                      <span className="truncate text-muted-foreground">{s.facultyName}</span>
                      {s.hasMarks ? <Badge variant="outline" className="ml-auto text-[10px]">Has marks</Badge> : s.set ? <Badge variant="outline" className="ml-auto text-[10px]">Set</Badge> : null}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className={cn("text-xs", pending ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{data ? (pending ? `CO pending for ${pending} box${pending === 1 ? "" : "es"}` : "Every box has a CO") : ""}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button loading={saving} disabled={!data} onClick={() => void save()}>Save Questions</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
