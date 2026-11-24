"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { dmy } from "@/lib/utils";

// Faculty > Mid Marks: every section + subject the faculty member teaches, per Mid whose paper the Exam Cell printed
// for that branch - with where its entry stands. Opens the sheet (question-wise, against the printed paper).

interface ClassRow {
  assignmentId: string; subjectCode?: string; subjectName: string; sectionName: string; department: string; year?: number; midNumber: number;
  sheetId: string; status: "NOT_STARTED" | "DRAFT" | "SUBMITTED"; complete: number; total: number; paperMax: number;
  state: { canEdit: boolean; reason: string; lastDate: string | null; open: boolean };
}

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

  return (
    <div className="space-y-5">
      <PageHeader title="Mid Marks" description="Enter each section's Mid marks question by question, against the paper the Exam Cell printed. Entry opens after the subject's exam." />
      {q.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {q.isError && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      {q.data && rows.length === 0 && <Card className="p-8 text-center text-sm text-muted-foreground">No Mid papers have been printed yet for the sections you teach.</Card>}
      {mids.map((mid) => (
        <section key={mid} className="space-y-2">
          <h2 className="text-sm font-semibold">Mid-{mid}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.filter((r) => r.midNumber === mid).map((r) => {
              const status = r.status === "SUBMITTED" ? "Submitted" : r.status === "DRAFT" ? `${r.complete} of ${r.total} complete` : "Not started";
              return (
                <Link key={r.sheetId} href={`/panel/mid-marks/${r.assignmentId}/${r.midNumber}`} className="block rounded-lg border bg-card p-4 transition-colors hover:border-primary">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.subjectName}</p>
                      <p className="text-xs text-muted-foreground">{r.subjectCode ? `${r.subjectCode} · ` : ""}{r.department} · {r.sectionName}</p>
                    </div>
                    <Badge variant={r.status === "SUBMITTED" ? "default" : "secondary"}>{status}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Out of {r.paperMax}
                    {r.state.lastDate ? ` · last date ${dmy(r.state.lastDate)}` : ""}
                  </p>
                  {!r.state.canEdit && r.status !== "SUBMITTED" && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{r.state.reason}</p>}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
