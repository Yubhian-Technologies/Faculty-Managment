"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpenCheck, CalendarClock, CalendarPlus, ChevronRight, Lock, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { daysLeft, deadlineLabel } from "@/lib/midBank/deadline";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import { deadlineProgress, type DeadlineProgress, type ProgressGroup } from "@/lib/midBank/progress";
import type { MidBankDeadline } from "@/types";

// Exam Cell > Mid Question Bank: every question bank deadline with how far its
// banks are (subjects, sections covered, questions written); each opens the
// per-branch / per-subject progress. Deadlines are set and edited on Mid Timings
// & Dates, the question rules on Settings.

type Row = MidBankDeadline & { locked: boolean };

export default function MidQuestionBankOverviewPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [summaries, setSummaries] = useState<Record<string, DeadlineProgress | "error">>({});
  const [error, setError] = useState("");
  const [show, setShow] = useState<"open" | "all">("open");

  useEffect(() => {
    fetch("/api/college/mid-bank-deadlines")
      .then(async (r) => {
        const d = (await r.json()) as { deadlines?: Row[]; error?: string };
        if (!r.ok) throw new Error(d.error ?? "Failed to load");
        const list = d.deadlines ?? [];
        setRows(list);
        // Each deadline's progress, loaded side by side.
        for (const row of list) {
          fetch(`/api/college/mid-bank-deadlines/${encodeURIComponent(row.id)}/progress`)
            .then(async (res) => { if (!res.ok) throw new Error(); return deadlineProgress(((await res.json()) as { groups: ProgressGroup[] }).groups); })
            .then((s) => setSummaries((m) => ({ ...m, [row.id]: s })))
            .catch(() => setSummaries((m) => ({ ...m, [row.id]: "error" })));
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  const shown = useMemo(() => (rows ?? []).filter((r) => show === "all" || !r.locked), [rows, show]);
  const openCount = (rows ?? []).filter((r) => !r.locked).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mid Question Bank"
        description="Question bank deadlines and how far the faculty have got - open one to see every branch, subject and section."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm"><Link href="/exam-cell/settings"><Settings2 className="mr-1.5 h-4 w-4" />Question rules</Link></Button>
            <Button asChild size="sm"><Link href="/exam-cell/mid-timings"><CalendarPlus className="mr-1.5 h-4 w-4" />Set / edit deadlines</Link></Button>
          </div>
        }
      />

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</p>
      ) : rows === null ? (
        <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl bg-muted" />)}</div>
      ) : rows.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary"><BookOpenCheck className="h-6 w-6" /></span>
            <p className="font-semibold">No question bank deadlines yet</p>
            <p className="max-w-md text-sm text-muted-foreground">Set the question rules for each course in Settings, then publish a deadline on Mid Timings &amp; Dates - the faculty teaching that semester are notified.</p>
            <Button asChild size="sm"><Link href="/exam-cell/mid-timings">Publish a deadline</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="inline-flex rounded-xl border bg-muted/40 p-1 text-sm" role="tablist" aria-label="Which deadlines">
            {([["open", `Open (${openCount})`], ["all", `All (${rows.length})`]] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={show === k} onClick={() => setShow(k)}
                className={cn("rounded-lg px-3.5 py-1.5 font-medium", show === k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{label}</button>
            ))}
          </div>
          {shown.length === 0 && <p className="text-sm text-muted-foreground">Every deadline has passed - see All.</p>}
          <div className="grid gap-4 md:grid-cols-2">
            {shown.map((r) => {
              const s = summaries[r.id];
              const left = daysLeft(r.deadline);
              const pct = s && s !== "error" ? s.pct : 0;
              return (
                <Link key={r.id} href={`/exam-cell/question-banks/${encodeURIComponent(r.id)}`}
                  className="group rounded-2xl border bg-card p-5 shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{ordinalYearLabel(r.year)} · Semester {r.semester}</p>
                      <p className="mt-0.5 truncate text-lg font-semibold">{r.courseName} <span className="text-primary">· Mid {r.midNumber}</span></p>
                    </div>
                    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
                      r.locked ? "bg-muted text-muted-foreground" : left !== null && left <= 2 ? "bg-amber-100 text-amber-900" : "bg-primary/10 text-primary")}>
                      {r.locked ? <Lock className="h-3 w-3" /> : <CalendarClock className="h-3 w-3" />}
                      {r.locked ? "Locked" : left === 0 ? "Due today" : left === 1 ? "1 day left" : `${left} days left`}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{deadlineLabel(r.deadline)}{r.extensions?.length ? ` · changed ${r.extensions.length}x` : ""}</p>

                  {s === "error" ? <p className="mt-4 text-sm text-destructive">Progress could not be loaded.</p> : !s ? (
                    <div className="mt-4 h-16 animate-pulse rounded-xl bg-muted" />
                  ) : (
                    <>
                      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                        {[["Subjects started", `${s.subjectsStarted}/${s.subjects}`], ["Sections covered", `${s.covered}/${s.sections}`], ["Banks complete", `${s.banksComplete}/${s.banks}`]].map(([k, v]) => (
                          <div key={k} className="rounded-xl bg-muted/50 px-2 py-2.5"><p className="text-lg font-bold">{v}</p><p className="text-[11px] text-muted-foreground">{k}</p></div>
                        ))}
                      </div>
                      <div className="mt-4">
                        <div className="mb-1 flex justify-between text-xs"><span className="text-muted-foreground">Overall - {s.ready} of {s.sections} sections have a complete bank</span><span className="font-semibold">{pct}%</span></div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Overall progress">
                          <div className={cn("h-full rounded-full", pct === 100 ? "bg-emerald-500" : "bg-primary")} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      {s.sections > s.covered && <p className="mt-3 text-xs text-amber-700">{s.sections - s.covered} section{s.sections - s.covered === 1 ? "" : "s"} not in any bank yet</p>}
                    </>
                  )}
                  <p className="mt-4 flex items-center gap-1 text-sm font-medium text-primary">View progress<ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></p>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
