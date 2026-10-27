"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BookOpen, CheckCircle2, Clock, FileDown } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";
import type { MidBankListItem } from "@/lib/midBank/clientTypes";

// Faculty > Add Mid Bank: every Mid question bank this faculty member has been
// assigned (by the HOD's Mid Paper Setter), with its progress and the one thing
// to do next. Banks that need attention come first.

const STATUS: Record<MidBankListItem["status"], { label: string; variant: "secondary" | "outline" | "default" }> = {
  NOT_STARTED: { label: "Not started", variant: "outline" },
  IN_PROGRESS: { label: "In progress", variant: "secondary" },
  COMPLETE: { label: "Complete", variant: "default" },
};
const ORDER = { IN_PROGRESS: 0, NOT_STARTED: 1, COMPLETE: 2 };
const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm";

function nextAction(b: MidBankListItem): { label: string; href: string; icon?: typeof FileDown } {
  const base = `/panel/mid-bank/${encodeURIComponent(b.id)}`;
  if (b.status === "COMPLETE") return { label: "Review bank", href: `${base}/review` };
  if (b.status === "IN_PROGRESS") return { label: "Continue bank", href: base };
  return { label: "Start bank", href: base };
}

export default function FacultyMidBankPage() {
  const [banks, setBanks] = useState<MidBankListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mid, setMid] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/mid-question-banks");
        const data = (await res.json()) as { banks?: MidBankListItem[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        setBanks(data.banks ?? []);
      } catch (e) {
        toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load your question banks" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const shown = useMemo(
    () => banks
      .filter((b) => (!mid || String(b.midNumber) === mid) && (!status || b.status === status))
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.subjectName.localeCompare(b.subjectName)),
    [banks, mid, status]
  );
  const mids = [...new Set(banks.map((b) => b.midNumber))].sort();

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Mid Question Bank"
        description="Prepare the Mid question banks you've been assigned. Each unit needs 10 questions, with Bloom's levels L2, L3 and L4 used at least 3 times each."
      />

      {banks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <select aria-label="Filter by Mid" className={selectClass} value={mid} onChange={(e) => setMid(e.target.value)}>
            <option value="">All Mids</option>
            {mids.map((m) => <option key={m} value={m}>Mid {m}</option>)}
          </select>
          <select aria-label="Filter by status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="NOT_STARTED">Not started</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="COMPLETE">Complete</option>
          </select>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">{[1, 2].map((i) => <div key={i} className="h-44 rounded-lg bg-muted animate-pulse" />)}</div>
      ) : banks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No Mid question banks assigned</p>
            <p className="mt-1 text-sm text-muted-foreground">Your HOD assigns these under Mid Paper Setter. They will appear here.</p>
          </CardContent>
        </Card>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No banks match these filters.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {shown.map((b) => {
            const pct = b.totalCount > 0 ? Math.round((b.completeCount / b.totalCount) * 100) : 0;
            const action = nextAction(b);
            const blocked = b.issues.some((i) => i.who === "EXAM_CELL");
            return (
              <Card key={b.id} className={b.status === "IN_PROGRESS" ? "border-primary/40" : undefined}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold leading-tight">{b.subjectName}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.subjectCode} · {b.courseName}{b.regulation ? ` · ${b.regulation}` : ""} · Year {b.year}{b.semester ? ` · Sem ${b.semester}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Badge variant="outline">Mid {b.midNumber}</Badge>
                      <Badge variant={STATUS[b.status].variant}>{STATUS[b.status].label}</Badge>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Sections</dt><dd>{b.sections.join(", ") || "-"}</dd>
                    <dt className="text-muted-foreground">Units</dt><dd>{b.started ? `Units ${b.units.join(", ")} (of ${b.unitsCount})` : b.unitsCount ? `${b.unitsCount} in the syllabus setup` : "Not set up yet"}</dd>
                    {b.started && <><dt className="text-muted-foreground">Drafts</dt><dd>{b.draftCount}</dd></>}
                    {b.updatedAt && <><dt className="text-muted-foreground">Last updated</dt><dd>{new Date(b.updatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</dd></>}
                  </dl>

                  {b.started && (
                    <div>
                      <div className="mb-1 flex justify-between text-xs"><span>{b.completeCount} of {b.totalCount} questions complete</span><span className="font-medium">{pct}%</span></div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${b.subjectName} Mid ${b.midNumber} progress`}>
                        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )}

                  {!b.started && b.issues.length > 0 && (
                    <div className="flex gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{b.issues[0].message}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {b.status === "COMPLETE" ? <><CheckCircle2 className="h-3.5 w-3.5 text-green-600" />Ready to download</> : blocked ? <><Clock className="h-3.5 w-3.5" />Waiting for the Exam Cell</> : null}
                    </span>
                    <div className="flex gap-2">
                      {b.status === "COMPLETE" && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/panel/mid-bank/${encodeURIComponent(b.id)}/review?download=1`}><FileDown className="mr-1.5 h-4 w-4" />Download PDF</Link>
                        </Button>
                      )}
                      <Button asChild size="sm" variant={b.status === "COMPLETE" ? "ghost" : "default"}>
                        <Link href={action.href}>{action.label}</Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
