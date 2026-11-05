"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, KeyRound, Shuffle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import { dayLabel } from "@/lib/midTimetable/rules";
import { downloadMidPaperSetPdf } from "@/lib/pdf/downloadMidPaperSet";
import type { MidBankDetail } from "@/lib/midBank/clientTypes";
import type { PaperChoiceDay, PaperChoiceRow } from "@/lib/midPapers/clientTypes";
import type { MidExamPlan, MidPaperQuestion, MidTimetable } from "@/types";

// Exam Cell > Mid Question Paper (a college that prepares question papers): pick a Mid timetable and an exam day;
// every subject + branch written that day lists the faculty's APPROVED question papers. Choose one (or "Pick at
// random") - the choice is saved - then download the chosen paper and its answer key.

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
      .catch(() => toast({ variant: "destructive", title: "Failed to load the timetable" }));
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
      if (!res.ok) throw new Error(json.error ?? "Could not load");
      setDay(json);
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not load" }); }
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
      if (!res.ok) throw new Error(json.error ?? "Could not save the choice");
      setDay((d) => d && ({ ...d, rows: d.rows.map((r) => (r === row ? { ...r, choice: json.choice ?? null } : r)) }));
      toast({ variant: "success", title: `Question paper ${json.choice?.setNo} of ${row.papers.find((p) => p.bankId === json.choice?.bankId)?.ownerName ?? ""} chosen` });
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not save" }); }
    finally { setBusy(""); }
  }

  async function download(row: PaperChoiceRow, answerKey: boolean) {
    if (!row.choice || !day) return;
    setBusy(`dl|${row.subjectId}|${row.branch}|${answerKey}`);
    try {
      const res = await fetch(`/api/college/mid-question-banks/${encodeURIComponent(row.choice.bankId)}`);
      const d = (await res.json()) as MidBankDetail & { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Could not load the paper");
      const b = d.bank;
      await downloadMidPaperSetPdf({
        exam: { courseName: day.header.courseCode, year: b.year, semester: b.semester, semesterInYear: day.header.semesterInYear, midNumber: b.midNumber, academicYear: day.header.academicYear, date: day.header.date },
        subject: { name: b.subjectName, code: b.subjectCode, regulation: d.subject.regulation },
        branch: row.branchCode, sections: b.sections.map((s) => s.sectionName), pattern: b.pattern!, set: row.choice.setNo,
        questions: d.questions as unknown as MidPaperQuestion[], outcomes: b.outcomes, cos: d.outcomes?.cos ?? [], mapping: d.outcomes?.mapping ?? {}, answerKey,
      }, `MID${b.midNumber}_${day.header.date}_${row.branchCode}_${b.subjectCode}${answerKey ? "_answer-key" : ""}`);
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not make the PDF" }); }
    finally { setBusy(""); }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Mid Question Paper" description="Choose, for every subject written on an exam day, which of the faculty's approved question papers is used - then download it and its answer key. Faculty don't see which one was chosen." />
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
                  <Button size="sm" onClick={() => void download(row, false)} loading={busy === `dl|${key}|false`}><Download className="mr-1.5 h-4 w-4" />Question paper</Button>
                  <Button size="sm" variant="outline" onClick={() => void download(row, true)} loading={busy === `dl|${key}|true`}><KeyRound className="mr-1.5 h-4 w-4" />Answer key</Button>
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
                    <button key={`${p.bankId}|${p.setNo}`} type="button" disabled={busy === key} onClick={() => void choose(row, { bankId: p.bankId, setNo: p.setNo })}
                      className={`rounded-lg border px-3 py-1.5 text-left text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:border-primary/50"}`}>
                      <span className="font-medium">{p.ownerName} · Paper {p.setNo}</span>
                      <span className="block text-[11px] opacity-80">Sections {p.sections.join(", ")}</span>
                    </button>
                  );
                })}
                <Button size="sm" variant="outline" disabled={busy === key} onClick={() => void choose(row, "random")}><Shuffle className="mr-1.5 h-4 w-4" />Pick at random</Button>
              </div>
            )}
            {row.choice && <p className="text-xs text-muted-foreground">Chosen by {row.choice.chosenByName || "the Exam Cell"}{row.choice.at ? ` · ${new Date(row.choice.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : ""}</p>}
            {row.pending.length > 0 && row.papers.length > 0 && <p className="text-xs text-muted-foreground">Not approved yet: {row.pending.map((p) => `${p.ownerName} (${p.stage})`).join(", ")}</p>}
          </CardContent></Card>
        );
      })}
    </div>
  );
}
