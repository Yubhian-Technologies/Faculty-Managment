"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, FileText, RefreshCw, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { MathText } from "@/components/midBank/MathText";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import { BLOOM_LEVELS } from "@/lib/midBank/constants";
import { partMarks } from "@/lib/midBank/validateQuestion";
import { dayLabel } from "@/lib/midTimetable/rules";
import { fetchCollegeLogoUrl } from "@/lib/pdf/logo";
import { renderHtmlToPdf, renderMultiHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { getMidQuestionPaperHTML, paperFileName, ROMAN } from "@/lib/pdf/midQuestionPaperTemplate";
import { pdfFormulaRenderer } from "@/lib/midBank/mathSvg";
import type { GeneratedPaper, GeneratedPapers, PaperQuestion } from "@/lib/midPaper/clientTypes";
import type { BloomLevel, MidExamPlan, MidTimetable } from "@/types";

// Exam Cell > Mid Exams > Mid Question Paper: pick a Mid timetable and an exam
// date, the level of Question 1, and generate a paper for every subject written
// that day (one per question bank). Review, swap a question or regenerate, then
// download. Nothing is stored - generate again any time.

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
type Plan = MidExamPlan & { timetables: { branch: string; status: string }[] };
type PlanDetail = { plan: MidExamPlan; branches: { branch: string; timetable: MidTimetable | null }[] };

/** Plain one-line text of a question for the Swap list. */
const preview = (q: PaperQuestion) => q.parts.map((p) => p.text.replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, "[formula]")).join(" / ").replace(/\s+/g, " ").slice(0, 110);

/** A fresh random pick: for each slot a candidate not used by another slot. */
function repick(p: GeneratedPaper): string[] {
  const used = new Set<string>();
  return p.slots.map((s) => {
    const pool = (p.candidates[s.no] ?? []).filter((id) => !used.has(id));
    const id = pool[Math.floor(Math.random() * pool.length)] ?? p.picked[s.no - 1];
    used.add(id);
    return id;
  });
}

export default function MidQuestionPaperPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [planId, setPlanId] = useState("");
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [date, setDate] = useState("");
  const [start, setStart] = useState<BloomLevel>("L2");
  const [result, setResult] = useState<GeneratedPapers | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/college/mid-timetables").then((r) => r.json() as Promise<{ plans?: Plan[] }>).then((d) => setPlans(d.plans ?? [])).catch(() => setPlans([]));
  }, []);
  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    fetch(`/api/college/mid-timetables/${encodeURIComponent(planId)}`)
      .then((r) => r.json() as Promise<PlanDetail>)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => toast({ variant: "destructive", title: "Failed to load the timetable" }));
    return () => { cancelled = true; };
  }, [planId]);

  // Exam days and the subjects written on each, from the saved branch timetables.
  const byDate = useMemo(() => {
    const m = new Map<string, { branch: string; subject: string; code: string }[]>();
    for (const b of detail?.branches ?? []) for (const s of b.timetable?.slots ?? []) {
      m.set(s.date, [...(m.get(s.date) ?? []), { branch: b.branch, subject: s.subjectName, code: s.subjectCode }]);
    }
    return new Map([...m.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }, [detail]);
  const dayRows = date ? byDate.get(date) ?? [] : [];

  async function generate() {
    setBusy("generate");
    try {
      const res = await fetch("/api/college/mid-question-papers", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId, date, startLevel: start }),
      });
      const json = (await res.json()) as GeneratedPapers & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not generate");
      setResult(json);
      const ok = json.papers.filter((p) => !p.error).length;
      toast({ variant: ok ? "success" : "destructive", title: `${ok} of ${json.papers.length} paper${json.papers.length === 1 ? "" : "s"} generated` });
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not generate" });
    } finally {
      setBusy(null);
    }
  }

  const setPicked = (key: string, picked: string[]) => setResult((r) => r && ({ ...r, papers: r.papers.map((p) => (p.key === key ? { ...p, picked } : p)) }));

  async function htmlOf(papers: GeneratedPaper[]) {
    const [info, logoUrl, formula] = await Promise.all([
      fetch("/api/college/info").then((r) => (r.ok ? r.json() : {})).catch(() => ({})) as Promise<{ name?: string }>,
      fetchCollegeLogoUrl(),
      pdfFormulaRenderer(),
    ]);
    return papers.map((paper) => getMidQuestionPaperHTML({ college: { name: info.name || "College", logoUrl }, header: result!.header, paper, formula }));
  }
  async function download(papers: GeneratedPaper[], key: string) {
    if (!result) return;
    setBusy(key);
    try {
      const htmls = await htmlOf(papers);
      if (papers.length === 1) await renderHtmlToPdf(htmls[0], paperFileName(result.header, papers[0]));
      else await renderMultiHtmlToPdf(htmls, `MID${result.header.midNumber}_${result.header.date}_question-papers.pdf`);
    } catch {
      toast({ variant: "destructive", title: "Could not make the PDF" });
    } finally {
      setBusy(null);
    }
  }

  const ready = result?.papers.filter((p) => !p.error) ?? [];

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Mid Question Paper" description="Generate each subject's Mid question paper from its question bank - pick the exam date and the level of Question 1. Nothing is saved; download the papers." />

      <Card className="rounded-2xl">
        <CardContent className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="qp-plan">Mid timetable</Label>
              <select id="qp-plan" className={selectClass} value={planId} onChange={(e) => { setPlanId(e.target.value); setDetail(null); setDate(""); setResult(null); }}>
                <option value="">{plans === null ? "Loading..." : plans.length ? "Select a Mid timetable" : "No Mid timetable yet"}</option>
                {(plans ?? []).map((p) => <option key={p.id} value={p.id}>{p.courseName} · {ordinalYearLabel(p.year)} · Sem {p.semester} · Mid {p.midNumber}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qp-date">Exam date</Label>
              <select id="qp-date" className={selectClass} value={date} disabled={!detail} onChange={(e) => { setDate(e.target.value); setResult(null); }}>
                <option value="">{detail && byDate.size === 0 ? "No exams placed yet" : "Select the date"}</option>
                {[...byDate.entries()].map(([d, rows]) => <option key={d} value={d}>{dayLabel(d)} · {rows.length} subject{rows.length === 1 ? "" : "s"}</option>)}
              </select>
            </div>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Level of Question 1</legend>
              <div className="inline-flex w-full rounded-lg border bg-muted/40 p-1">
                {BLOOM_LEVELS.map((l) => (
                  <label key={l} className={cn("flex-1 cursor-pointer rounded-md py-1 text-center text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", start === l ? "bg-background shadow-sm" : "text-muted-foreground")}>
                    <input type="radio" name="qp-start" className="sr-only" checked={start === l} onChange={() => { setStart(l); setResult(null); }} />{l}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          {date && (
            <div className="rounded-xl border bg-muted/20 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Exams on {dayLabel(date)}</p>
              <ul className="flex flex-wrap gap-2 text-xs">
                {dayRows.map((r) => <li key={`${r.branch}|${r.code}`} className="rounded-full border bg-background px-2.5 py-1"><span className="font-medium">{r.subject}</span> <span className="text-muted-foreground">· {r.branch}</span></li>)}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {ready.length > 1 && <Button variant="outline" onClick={() => void download(ready, "all")} loading={busy === "all"}><Download className="mr-1.5 h-4 w-4" />Download all ({ready.length}) as one PDF</Button>}
            <Button onClick={() => void generate()} loading={busy === "generate"} disabled={!planId || !date}><Sparkles className="mr-1.5 h-4 w-4" />{result ? "Generate again" : "Generate papers"}</Button>
          </div>
        </CardContent>
      </Card>

      {result?.papers.map((p) => (
        <Card key={p.key} className="rounded-2xl">
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{p.branch}{p.sections.length ? ` · Sections ${p.sections.join(", ")}` : ""}{p.ownerName ? ` · Bank by ${p.ownerName}` : ""}</p>
                <h2 className="text-lg font-semibold">{p.subjectName} <span className="text-sm font-normal text-muted-foreground">({p.subjectCode})</span></h2>
                {!p.error && <p className="text-sm text-muted-foreground">Max. marks {p.maxMarks} · Levels {p.slots.map((s) => s.level.replace("L", "")).join(", ")}</p>}
              </div>
              {!p.error && (
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setPicked(p.key, repick(p))}><RefreshCw className="mr-1.5 h-4 w-4" />Regenerate</Button>
                  <Button size="sm" onClick={() => void download([p], p.key)} loading={busy === p.key}><FileText className="mr-1.5 h-4 w-4" />PDF</Button>
                </div>
              )}
            </div>

            {p.error ? (
              <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div><p className="font-medium">{p.error}</p>{p.shortages?.map((s) => <p key={s} className="text-xs">{s}</p>)}</div>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr><th className="w-14 p-2 text-left">Q</th><th className="p-2 text-left">Question</th><th className="w-14 p-2">Marks</th><th className="w-12 p-2">CO</th><th className="w-12 p-2">BL</th></tr>
                  </thead>
                  <tbody>
                    {p.slots.map((s, i) => {
                      const q = p.questions[p.picked[i]];
                      const others = (p.candidates[s.no] ?? []).filter((id) => id === p.picked[i] || !p.picked.includes(id));
                      return (
                        <Fragment key={s.no}>
                          {i % 2 === 1 && <tr className="border-t bg-muted/30"><td colSpan={5} className="p-1 text-center text-xs font-bold">OR</td></tr>}
                          {(i % 2 === 0 || s.unit !== p.slots[i - 1].unit) && (
                            <tr className="border-t bg-muted/20"><td colSpan={5} className="p-2 text-xs font-bold">UNIT-{ROMAN[s.unit] ?? s.unit}{p.unitTitles[String(s.unit)] ? ` · ${p.unitTitles[String(s.unit)]}` : ""}</td></tr>
                          )}
                          {q.parts.map((part, j) => (
                            <tr key={j} className="border-t align-top">
                              <td className="p-2 font-semibold">{q.parts.length === 1 ? s.no : `${s.no}.${"abcde"[j]}`}</td>
                              <td className="p-2">
                                <MathText text={part.text} />
                                {/* eslint-disable-next-line @next/next/no-img-element -- Storage URL with a token */}
                                {part.imageUrl && <img src={part.imageUrl} alt={part.imageCaption || ""} className="mt-2 max-h-32 rounded border" />}
                                {j === q.parts.length - 1 && others.length > 1 && (
                                  <select aria-label={`Swap question ${s.no}`} className="mt-2 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-muted-foreground" value={q.id}
                                    onChange={(e) => setPicked(p.key, p.picked.map((id, k) => (k === i ? e.target.value : id)))}>
                                    {others.map((id) => <option key={id} value={id}>{id === q.id ? "Swap for another question..." : `U${p.questions[id].unit} Q${p.questions[id].slot}: ${preview(p.questions[id])}`}</option>)}
                                  </select>
                                )}
                              </td>
                              <td className="p-2 text-center">{partMarks(part, j, q.format ?? (q.parts.length === 1 ? "SINGLE" : "PARTS_AB"), p.marks)}</td>
                              <td className="p-2 text-center">{part.cos.map((c) => c.replace("CO", "")).join(", ")}</td>
                              <td className="p-2 text-center">{part.bloom.replace("L", "")}</td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
