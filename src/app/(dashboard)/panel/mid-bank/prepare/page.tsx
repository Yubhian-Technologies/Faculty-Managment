"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { PrepareBank, type PrepareStep } from "@/components/midBank/PrepareBank";
import type { MidBankPrepare } from "@/lib/midBank/clientTypes";

// Faculty: set up (or change the sections of) a question bank for one deadline +
// subject + branch. ?deadlineId=&subjectId=&branch=
//
// The query is read with useSearchParams (the real URL in the browser), not the page's
// `searchParams` prop: this route has no dynamic segment, so the production build prerenders it
// as static and the prop arrived empty there - every load asked the API for an empty bank (500).
export default function PrepareMidBankPage() {
  return <Suspense fallback={<div className="h-96 max-w-6xl animate-pulse rounded-lg bg-muted" />}><PrepareMidBank /></Suspense>;
}

function PrepareMidBank() {
  const sp = useSearchParams();
  const q = { deadlineId: sp.get("deadlineId") ?? undefined, subjectId: sp.get("subjectId") ?? undefined, branch: sp.get("branch") ?? undefined, step: sp.get("step") ?? undefined };
  // Kept here, not in the wizard: the wizard is rebuilt from fresh data after each save.
  const [step, setStep] = useState<PrepareStep>(() => (q.step === "2" ? 2 : q.step === "3" ? 3 : 1));
  const [data, setData] = useState<MidBankPrepare | null>(null);
  const [error, setError] = useState("");

  const complete = !!(q.deadlineId && q.subjectId && q.branch);

  const load = useCallback(() => {
    if (!q.deadlineId || !q.subjectId || !q.branch) return;
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
        title={data ? `${data.subject.name} - Mid ${data.deadline.midNumber}` : "Prepare for the Mid"}
        description={data ? `${data.subject.code} · ${data.branch} · ${data.midPreparation === "PAPERS" ? "pick the sections, then write the question papers" : "sections, then the setup, then the questions"}.` : undefined}
        actions={<Button asChild variant="ghost" size="sm"><Link href="/panel/mid-bank"><ArrowLeft className="mr-1.5 h-4 w-4" />All subjects</Link></Button>}
      />
      {!complete ? (
        <p className="rounded-lg border bg-muted/30 p-4 text-sm" role="status">
          This link doesn&rsquo;t say which subject to open. <Link href="/panel/mid-bank" className="font-medium text-primary underline">Go to the subjects</Link> and pick the subject there.
        </p>
      ) : error ? <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</p>
        : !data ? <div className="h-96 animate-pulse rounded-lg bg-muted" />
        : <PrepareBank key={`${data.outcomes?.version ?? 0}-${data.myBankId ?? ""}`} data={data} step={step} onStep={setStep} onChanged={load} />}
    </div>
  );
}
