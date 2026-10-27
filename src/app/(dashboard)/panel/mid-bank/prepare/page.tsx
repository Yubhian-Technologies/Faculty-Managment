"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { PrepareBank, type PrepareStep } from "@/components/midBank/PrepareBank";
import type { MidBankPrepare } from "@/lib/midBank/clientTypes";

// Faculty: set up (or change the sections of) a question bank for one deadline +
// subject + branch. ?deadlineId=&subjectId=&branch=
export default function PrepareMidBankPage({ searchParams }: { searchParams: Promise<{ deadlineId?: string; subjectId?: string; branch?: string; step?: string }> }) {
  const q = use(searchParams);
  // Kept here, not in the wizard: the wizard is rebuilt from fresh data after each save.
  const [step, setStep] = useState<PrepareStep>(() => (q.step === "2" ? 2 : q.step === "3" ? 3 : 1));
  const [data, setData] = useState<MidBankPrepare | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const params = new URLSearchParams({ deadlineId: q.deadlineId ?? "", subjectId: q.subjectId ?? "", branch: q.branch ?? "" });
    fetch(`/api/college/mid-question-banks/prepare?${params}`)
      .then(async (r) => {
        const d = (await r.json()) as MidBankPrepare & { error?: string };
        if (!r.ok) throw new Error(d.error ?? "Failed to load");
        setData(d);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [q.deadlineId, q.subjectId, q.branch]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title={data ? `${data.subject.name} - Mid ${data.deadline.midNumber}` : "Prepare question bank"}
        description={data ? `${data.subject.code} · ${data.branch} · four steps: sections, course outcomes, CO-PO mapping, then the questions.` : undefined}
        actions={<Button asChild variant="ghost" size="sm"><Link href="/panel/mid-bank"><ArrowLeft className="mr-1.5 h-4 w-4" />Question Bank</Link></Button>}
      />
      {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</p>
        : !data ? <div className="h-96 animate-pulse rounded-lg bg-muted" />
        : <PrepareBank key={`${data.outcomes?.version ?? 0}-${data.myBankId ?? ""}`} data={data} step={step} onStep={setStep} onChanged={load} />}
    </div>
  );
}
