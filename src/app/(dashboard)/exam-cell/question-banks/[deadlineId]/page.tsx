"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { deadlineLabel } from "@/lib/midBank/deadline";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import type { MidBankDeadline, MidQuestionBank } from "@/types";

// Exam Cell: how far the question banks of one deadline are - per branch and
// subject, every section, which bank covers it, each bank's progress, and the
// sections nobody has started yet.

interface Progress {
  deadline: MidBankDeadline & { locked: boolean };
  groups: {
    branch: string; subjectId: string; subjectName: string; subjectCode: string;
    sections: { sectionId: string; sectionName: string; facultyNames: string[]; bankId: string | null; ownerName: string | null }[];
    banks: { id: string; ownerName: string; sections: string[]; status: MidQuestionBank["status"]; completeCount: number; totalCount: number; updatedAt: string | null }[];
  }[];
}

export default function QuestionBankProgressPage({ params }: { params: Promise<{ deadlineId: string }> }) {
  const { deadlineId } = use(params);
  const [data, setData] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [branch, setBranch] = useState("");

  useEffect(() => {
    fetch(`/api/college/mid-bank-deadlines/${encodeURIComponent(deadlineId)}/progress`)
      .then(async (r) => { const d = (await r.json()) as Progress & { error?: string }; if (!r.ok) throw new Error(d.error ?? "Failed to load"); setData(d); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [deadlineId]);

  const branches = useMemo(() => [...new Set((data?.groups ?? []).map((g) => g.branch))].sort(), [data]);
  const shown = (data?.groups ?? []).filter((g) => !branch || g.branch === branch);
  const totals = useMemo(() => {
    const all = (data?.groups ?? []).flatMap((g) => g.sections);
    const banks = (data?.groups ?? []).flatMap((g) => g.banks);
    return { sections: all.length, covered: all.filter((s) => s.bankId).length, banks: banks.length, complete: banks.filter((b) => b.status === "COMPLETE").length };
  }, [data]);

  const d = data?.deadline;
  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Question bank progress"
        description={d ? `${d.courseName} · ${ordinalYearLabel(d.year)} · Semester ${d.semester} · Mid ${d.midNumber}` : undefined}
        actions={<Button asChild variant="ghost" size="sm"><Link href="/exam-cell/question-banks"><ArrowLeft className="mr-1.5 h-4 w-4" />Mid Question Bank</Link></Button>}
      />
      {error && <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</p>}
      {!data && !error && <div className="h-80 animate-pulse rounded-lg bg-muted" />}
      {data && d && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["Deadline", <span key="d" className="flex items-center gap-1">{d.locked && <Lock className="h-4 w-4" />}{deadlineLabel(d.deadline)}</span>],
              ["Sections covered", `${totals.covered} of ${totals.sections}`],
              ["Banks started", totals.banks],
              ["Banks complete", `${totals.complete} of ${totals.banks}`],
            ].map(([label, value]) => (
              <Card key={label as string}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-lg font-semibold">{value}</p></CardContent></Card>
            ))}
          </div>

          {branches.length > 1 && (
            <select aria-label="Filter by branch" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}

          {shown.length === 0 ? (
            <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">No subjects of this semester have teaching assignments yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr><th className="p-3">Branch</th><th className="p-3">Subject</th><th className="p-3">Sections</th><th className="p-3">Banks</th></tr>
                </thead>
                <tbody>
                  {shown.map((g) => (
                    <tr key={`${g.branch}|${g.subjectId}`} className="border-t align-top">
                      <td className="p-3">{g.branch}</td>
                      <td className="p-3"><p className="font-medium">{g.subjectName}</p><p className="text-xs text-muted-foreground">{g.subjectCode}</p></td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {g.sections.map((s) => (
                            <Badge key={s.sectionId} variant="outline" className={s.bankId ? "" : "border-amber-500/60 text-amber-800 dark:text-amber-300"} title={s.facultyNames.join(", ")}>
                              {s.sectionName}: {s.bankId ? s.ownerName : "not started"}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="p-3">
                        {g.banks.length === 0 ? <span className="text-xs text-muted-foreground">None yet</span> : (
                          <ul className="space-y-1.5">
                            {g.banks.map((b) => {
                              const pct = b.totalCount ? Math.round((b.completeCount / b.totalCount) * 100) : 0;
                              return (
                                <li key={b.id} className="flex items-center gap-2">
                                  <Link className="text-primary underline" href={`/exam-cell/question-banks/${encodeURIComponent(deadlineId)}/${encodeURIComponent(b.id)}`}>{b.ownerName}</Link>
                                  <span className="text-xs text-muted-foreground">sec {b.sections.join(", ")}</span>
                                  <Badge variant={b.status === "COMPLETE" ? "default" : "secondary"}>{b.status === "COMPLETE" ? "Complete" : `${pct}%`}</Badge>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
