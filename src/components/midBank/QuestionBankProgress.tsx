"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Lock, Search, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { deadlineLabel } from "@/lib/midBank/deadline";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import { deadlineProgress } from "@/lib/midBank/progress";
import { bankStage, GROUP_CLASS, GROUP_LABEL, groupStage, STAGE_CLASS, STAGE_LABEL, type GroupStage } from "@/lib/midBank/approval";
import type { MidBankApprovalEntry, MidBankDeadline, MidQuestionBank } from "@/types";

// How far the question banks of one deadline are - per branch and subject,
// every section, which bank covers it, each bank's progress and HOD approval,
// and the sections nobody has started yet. The Exam Cell sees every branch
// (banks before approval too, with their status); an HOD their own branches,
// opening a bank to approve or return it.

interface Progress {
  deadline: MidBankDeadline & { locked: boolean };
  groups: {
    branch: string; subjectId: string; subjectName: string; subjectCode: string;
    sections: { sectionId: string; sectionName: string; facultyNames: string[]; bankId: string | null; ownerName: string | null }[];
    banks: { id: string; ownerName: string; sections: string[]; status: MidQuestionBank["status"]; approval: MidQuestionBank["approval"] | null; lastApproval: MidBankApprovalEntry | null; completeCount: number; totalCount: number; updatedAt: string | null }[];
  }[];
}

const groupStatus = (g: Progress["groups"][number]): GroupStage => groupStage(g.sections, g.banks.map((b) => ({ ...b, approval: b.approval ?? undefined })));
const STATUS_LABEL = GROUP_LABEL;
const STATUS_CLASS = GROUP_CLASS;
type GroupStatus = GroupStage;

export function QuestionBankProgress({ deadlineId, base, examCell }: { deadlineId: string; base: string; examCell: boolean }) {
  const [data, setData] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [branch, setBranch] = useState("");
  const [status, setStatus] = useState<"" | GroupStatus>("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch(`/api/college/mid-bank-deadlines/${encodeURIComponent(deadlineId)}/progress`)
      .then(async (r) => { const d = (await r.json()) as Progress & { error?: string }; if (!r.ok) throw new Error(d.error ?? "Failed to load"); setData(d); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [deadlineId]);

  const branches = useMemo(() => [...new Set((data?.groups ?? []).map((g) => g.branch))].sort(), [data]);
  const allGroups = data?.groups ?? [];
  const q = query.trim().toLowerCase();
  const shown = allGroups.filter((g) =>
    (!branch || g.branch === branch)
    && (!status || groupStatus(g) === status)
    && (!q || [g.subjectName, g.subjectCode, ...g.sections.flatMap((s) => s.facultyNames), ...g.banks.map((b) => b.ownerName)].some((t) => t.toLowerCase().includes(q))));
  const filtered = Boolean(branch || status || q);
  const totals = useMemo(() => deadlineProgress(data?.groups ?? []), [data]);

  const d = data?.deadline;
  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Question bank progress"
        description={d ? `${d.courseName} · ${ordinalYearLabel(d.year)} · Semester ${d.semester} · Mid ${d.midNumber}` : undefined}
        actions={<Button asChild variant="ghost" size="sm"><Link href={base}><ArrowLeft className="mr-1.5 h-4 w-4" />Mid Question Bank</Link></Button>}
      />
      {error && <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</p>}
      {!data && !error && <div className="h-80 animate-pulse rounded-lg bg-muted" />}
      {data && d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Deadline", <span key="d" className="flex items-center gap-1">{d.locked && <Lock className="h-4 w-4" />}{deadlineLabel(d.deadline)}</span>],
              ["Overall progress", `${totals.pct}% · ${totals.ready} of ${totals.sections} sections ready`],
              ["Sections covered", `${totals.covered} of ${totals.sections}`],
              ["Approved by HOD", `${totals.subjectsApproved} of ${totals.subjects} subjects${totals.banksSubmitted ? ` · ${totals.banksSubmitted} waiting` : ""}`],
            ].map(([label, value]) => (
              <Card key={label as string}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-lg font-semibold">{value}</p></CardContent></Card>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Search subject or faculty" placeholder="Search subject, code or faculty" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
            </div>
            <select aria-label="Filter by branch" className="h-9 min-w-48 rounded-md border border-input bg-background px-3 text-sm" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">All branches ({branches.length})</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select aria-label="Filter by status" className="h-9 min-w-40 rounded-md border border-input bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value as "" | GroupStatus)}>
              <option value="">Any status</option>
              {(Object.keys(STATUS_LABEL) as GroupStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]} ({allGroups.filter((g) => groupStatus(g) === k).length})</option>)}
            </select>
            {filtered && <Button variant="ghost" size="sm" onClick={() => { setBranch(""); setStatus(""); setQuery(""); }}><X className="mr-1 h-4 w-4" />Clear filters</Button>}
            <p className="ml-auto self-center text-xs text-muted-foreground">Showing {shown.length} of {allGroups.length} subjects</p>
          </div>

          {shown.length === 0 ? (
            <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">{filtered ? "No subjects match these filters." : "No subjects of this semester have teaching assignments yet."}</p>
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
                      <td className="p-3">
                        <p className="font-medium">{g.subjectName}</p>
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">{g.subjectCode}
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLASS[groupStatus(g)]}`}>{STATUS_LABEL[groupStatus(g)]}</span>
                        </p>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {g.sections.map((s) => (
                            <Badge key={s.sectionId} variant="outline" className={s.bankId ? "" : "border-amber-500/60 text-amber-800"} title={s.facultyNames.join(", ")}>
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
                                  <Link className="text-primary underline" href={`${base}/${encodeURIComponent(deadlineId)}/${encodeURIComponent(b.id)}`}>{b.ownerName}</Link>
                                  <span className="text-xs text-muted-foreground">sec {b.sections.join(", ")}</span>
                                  {(() => { const st = bankStage({ status: b.status, approval: b.approval ?? undefined }); return (
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STAGE_CLASS[st]}`} title={b.lastApproval ? `${b.lastApproval.byName}${b.lastApproval.remarks ? ` - ${b.lastApproval.remarks}` : ""}` : undefined}>
                                      {st === "IN_PROGRESS" ? `${pct}%` : STAGE_LABEL[st]}
                                    </span>); })()}
                                  {!examCell && b.approval === "SUBMITTED" && <Button asChild size="sm" variant="outline" className="h-7"><Link href={`${base}/${encodeURIComponent(deadlineId)}/${encodeURIComponent(b.id)}`}>Review</Link></Button>}
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
