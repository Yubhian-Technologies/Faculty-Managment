"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, CircleDashed, ClipboardList, Lock, MessageSquareWarning, Send } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { cn, dmy } from "@/lib/utils";

// Faculty > Mid Marks: every section + subject the faculty member teaches, per Mid whose paper the Exam Cell printed
// for that branch - where each one stands (to enter / with the Exam Cell / frozen) and opens its sheet.

interface ClassRow {
  assignmentId: string; subjectCode?: string; subjectName: string; sectionName: string; department: string; year?: number; midNumber: number;
  sheetId: string; status: "NOT_STARTED" | "DRAFT" | "SUBMITTED" | "FROZEN"; changeRequested: boolean; complete: number; total: number; paperMax: number;
  state: { canEdit: boolean; reason: string; lastDate: string | null; open: boolean };
}

const STATUS: Record<ClassRow["status"], { label: string; cls: string; icon: typeof Lock }> = {
  NOT_STARTED: { label: "Not Started", cls: "bg-muted text-muted-foreground", icon: CircleDashed },
  DRAFT: { label: "In Progress", cls: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200", icon: CircleDashed },
  SUBMITTED: { label: "With Exam Cell", cls: "bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-200", icon: Send },
  FROZEN: { label: "Frozen", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200", icon: Lock },
};

export default function MidMarksListPage() {
  const q = useQuery({
    queryKey: ["mid-marks-classes"],
    queryFn: async () => {
      const res = await fetch("/api/college/mid-marks-sheets");
      const d = (await res.json()) as { classes?: ClassRow[]; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Unable to load your classes.");
      return d.classes ?? [];
    },
  });
  const rows = q.data ?? [];
  const mids = [...new Set(rows.map((r) => r.midNumber))].sort((a, b) => b - a);
  const toDo = rows.filter((r) => r.state.canEdit && (r.status === "NOT_STARTED" || r.status === "DRAFT")).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Mid Marks" description="Enter section-wise Mid examination marks question-wise, as per the question paper provided by the Exam Cell. Submit marks to the Exam Cell. Changes after freezing require a formal request." />
      {q.isLoading && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />)}</div>}
      {q.isError && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      {q.data && rows.length === 0 && (
        <Card className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
          <ClipboardList className="h-8 w-8" />No Mid papers have been printed yet for the sections you teach.
        </Card>
      )}
      {q.data && rows.length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          <Pill label="To Enter" value={toDo} strong={toDo > 0} />
          <Pill label="With Exam Cell" value={rows.filter((r) => r.status === "SUBMITTED").length} />
          <Pill label="Frozen" value={rows.filter((r) => r.status === "FROZEN").length} />
        </div>
      )}
      {mids.map((mid) => (
        <section key={mid} className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><span className="rounded-md bg-primary px-2 py-0.5 text-xs text-primary-foreground">Mid-{mid}</span>{rows.filter((r) => r.midNumber === mid).length} section{rows.filter((r) => r.midNumber === mid).length === 1 ? "" : "s"}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.filter((r) => r.midNumber === mid).map((r) => {
              const st = STATUS[r.status];
              const pct = r.status === "SUBMITTED" || r.status === "FROZEN" ? 100 : r.total ? Math.round((r.complete / r.total) * 100) : 0;
              const action = r.state.canEdit ? (r.status === "NOT_STARTED" ? "Start Entering" : "Continue") : "View";
              return (
                <Link key={r.sheetId} href={`/panel/mid-marks/${r.assignmentId}/${r.midNumber}`}
                  className={cn("group flex flex-col rounded-xl border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary hover:shadow-md", r.state.canEdit && r.status !== "SUBMITTED" && "border-primary/40")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{r.subjectName}</p>
                      <p className="text-xs text-muted-foreground">{r.subjectCode ? `${r.subjectCode} · ` : ""}Section {r.sectionName}</p>
                    </div>
                    <span className={cn("flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", st.cls)}><st.icon className="h-3 w-3" />{st.label}</span>
                  </div>
                  <div className="mt-4 space-y-1">
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">{r.total ? `${r.status === "SUBMITTED" || r.status === "FROZEN" ? r.total : r.complete} of ${r.total} students` : "Not opened yet"}</span><span className="font-medium">out of {r.paperMax}</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", r.status === "FROZEN" ? "bg-emerald-500" : "bg-primary")} style={{ width: `${pct}%` }} /></div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
                      {r.changeRequested ? <><MessageSquareWarning className="h-3.5 w-3.5 text-amber-600" />Change request waiting</>
                        : r.state.lastDate ? <><CalendarClock className="h-3.5 w-3.5" />Last date {dmy(r.state.lastDate)}</>
                        : !r.state.canEdit && r.status === "NOT_STARTED" ? <span className="truncate">{r.state.reason}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 font-medium text-primary">{action}<ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function Pill({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <span className={cn("rounded-full border px-3 py-1", strong ? "border-primary bg-primary/10 text-primary" : "bg-card text-muted-foreground")}>
      <span className="font-semibold tabular-nums">{value}</span> {label}
    </span>
  );
}
