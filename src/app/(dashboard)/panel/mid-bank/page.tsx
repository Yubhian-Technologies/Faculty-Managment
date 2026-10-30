"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, CheckCircle2, Eye, Lock } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";
import { deadlineLabel } from "@/lib/midBank/deadline";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import { bankStage, STAGE_CLASS, STAGE_LABEL } from "@/lib/midBank/approval";
import type { MidBankListItem } from "@/lib/midBank/clientTypes";

// Faculty > Question Bank: once the Exam Cell sets a Mid's question bank
// deadline, every subject this faculty member teaches in that semester shows
// here, per branch + subject: their sections and colleagues', who holds each,
// their own bank's progress, and colleagues' banks that cover their sections
// (read-only). Banks lock when the deadline passes.

const prepareHref = (i: MidBankListItem) =>
  `/panel/mid-bank/prepare?${new URLSearchParams({ deadlineId: i.deadline.id, subjectId: i.subject.id, branch: i.branch })}`;

export default function FacultyQuestionBankPage() {
  const [items, setItems] = useState<MidBankListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/mid-question-banks");
        const data = (await res.json()) as { items?: MidBankListItem[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        setItems(data.items ?? []);
      } catch (e) {
        toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load your question banks" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // One group per deadline (course + year + semester + Mid), open ones first.
  const groups = useMemo(() => {
    const m = new Map<string, MidBankListItem[]>();
    for (const i of items) m.set(i.deadline.id, [...(m.get(i.deadline.id) ?? []), i]);
    return [...m.values()];
  }, [items]);

  return (
    <div className="max-w-5xl space-y-8">
      <PageHeader
        title="Question Bank"
        description="Prepare the Mid question banks for the subjects you teach, before the Exam Cell's deadline. Each unit needs 10 questions with Bloom's levels L2, L3 and L4 at least 3 times each."
      />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">{[1, 2].map((i) => <div key={i} className="h-44 animate-pulse rounded-lg bg-muted" />)}</div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No question banks open</p>
            <p className="mt-1 text-sm text-muted-foreground">When the Exam Cell sets a Mid&rsquo;s question bank deadline, your subjects for that semester appear here.</p>
          </CardContent>
        </Card>
      ) : (
        groups.map((list) => {
          const d = list[0].deadline;
          return (
            <section key={d.id} className="space-y-3" aria-labelledby={`dl-${d.id}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={`dl-${d.id}`} className="text-base font-semibold">
                  Mid {d.midNumber} · {d.courseName} · {ordinalYearLabel(d.year)} · Semester {d.semester}
                </h2>
                <Badge variant={d.locked ? "secondary" : "outline"} className={d.locked ? "" : "border-primary/50 text-primary"}>
                  {d.locked && <Lock className="mr-1 h-3 w-3" />}{deadlineLabel(d.deadline)}
                </Badge>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {list.map((i) => {
                  const pct = i.myBank && i.myBank.totalCount ? Math.round((i.myBank.completeCount / i.myBank.totalCount) * 100) : 0;
                  return (
                    <Card key={i.key} className={i.myBank && i.myBank.status !== "COMPLETE" && !d.locked ? "border-primary/40" : undefined}>
                      <CardContent className="space-y-3 p-4">
                        <div>
                          <p className="font-semibold leading-tight">{i.subject.name}</p>
                          <p className="text-xs text-muted-foreground">{i.subject.code} · {i.branch}</p>
                        </div>

                        <div className="flex flex-wrap gap-1.5" aria-label="Sections">
                          {i.sections.map((s) => (
                            <Badge key={s.sectionId} variant="outline" className={s.mine ? "border-primary/50" : ""} title={s.facultyNames.join(", ")}>
                              {s.sectionName}{s.mine ? " (you)" : ` · ${s.facultyNames[0] ?? ""}`}
                              {s.heldBy && <span className="ml-1 text-muted-foreground">- in {s.mine && i.myBank?.sections.includes(s.sectionName) ? "your" : `${s.heldBy}'s`} bank</span>}
                            </Badge>
                          ))}
                        </div>

                        {i.myBank && (
                          <div>
                            <div className="mb-1 flex justify-between text-xs">
                              <span>Your bank (sections {i.myBank.sections.join(", ")}): {i.myBank.completeCount} of {i.myBank.totalCount} questions</span>
                              <span className="font-medium">{pct}%</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${i.subject.name} progress`}>
                              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )}

                        {i.sharedBanks.map((b) => (
                          <p key={b.id} className="flex items-center justify-between gap-2 text-xs">
                            <span>{b.ownerName} is preparing it for section {b.sections.join(", ")} ({b.completeCount}/{b.totalCount})</span>
                            <Link className="shrink-0 text-primary underline" href={`/panel/mid-bank/${encodeURIComponent(b.id)}/review`}><Eye className="mr-0.5 inline h-3 w-3" />View</Link>
                          </p>
                        ))}

                        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                          {i.myBank && i.myBank.status === "COMPLETE" && (() => { const st = bankStage({ status: i.myBank.status, approval: i.myBank.approval ?? undefined }); return (
                            <span className={`mr-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_CLASS[st]}`}>{st === "APPROVED" && <CheckCircle2 className="h-3.5 w-3.5" />}{st === "READY" ? "Complete - submit to HOD" : STAGE_LABEL[st]}</span>); })()}
                          {i.myBank ? (
                            <>
                              <Button asChild size="sm" variant="outline"><Link href={`/panel/mid-bank/${encodeURIComponent(i.myBank.id)}/review`}>Review</Link></Button>
                              {!d.locked && (i.myBank.status !== "COMPLETE" || i.myBank.approval === "RETURNED") && <Button asChild size="sm"><Link href={`/panel/mid-bank/${encodeURIComponent(i.myBank.id)}`}>Continue</Link></Button>}
                            </>
                          ) : i.uncovered.length > 0 ? (
                            d.locked
                              ? <span className="text-xs text-muted-foreground">Not prepared - the deadline has passed</span>
                              : <Button asChild size="sm"><Link href={prepareHref(i)}>Prepare bank</Link></Button>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
