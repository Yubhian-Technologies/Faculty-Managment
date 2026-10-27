"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { BankSetup } from "@/components/midBank/BankSetup";
import { BankWorkspace } from "@/components/midBank/BankWorkspace";
import type { MidBankDetail } from "@/lib/midBank/clientTypes";
import { bankFormatText } from "@/lib/midBank/validateQuestion";

// One Mid question bank: the setup until it is started, then the workspace.
// Someone who only reads it (the HOD) is sent to the review screen.

export default function MidBankPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const { id } = use(params);
  const { q } = use(searchParams);
  const router = useRouter();
  const [detail, setDetail] = useState<MidBankDetail | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    fetch(`/api/college/mid-question-banks/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const d = (await r.json()) as MidBankDetail & { error?: string };
        if (!r.ok) throw new Error(d.error ?? "Failed to load the question bank");
        setDetail(d);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load the question bank"));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (detail && detail.bank && !detail.access.isHolder) router.replace(`/panel/mid-bank/${encodeURIComponent(id)}/review`);
  }, [detail, id, router]);

  const back = (
    <Button asChild variant="ghost" size="sm">
      <Link href="/panel/mid-bank"><ArrowLeft className="mr-1.5 h-4 w-4" />All banks</Link>
    </Button>
  );

  if (error) {
    return (
      <div className="space-y-4">
        {back}
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</p>
      </div>
    );
  }
  if (!detail) return <div className="space-y-4"><div className="h-10 w-64 animate-pulse rounded bg-muted" /><div className="h-96 animate-pulse rounded-lg bg-muted" /></div>;

  const title = `${detail.subject.name} - Mid ${detail.assignment.midNumber}`;
  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={detail.bank
          ? `${detail.subject.code} · Units ${detail.bank.units.join(", ")} · ${bankFormatText(detail.bank.format, detail.bank.marks)}`
          : `${detail.subject.code} · Review the subject setup, then start writing questions.`}
        actions={back}
      />
      {detail.bank && detail.access.isHolder ? <BankWorkspace detail={detail} initialQ={q} /> : <BankSetup detail={detail} onChanged={load} />}
    </div>
  );
}
