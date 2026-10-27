"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { BankWorkspace } from "@/components/midBank/BankWorkspace";
import { deadlineLabel } from "@/lib/midBank/deadline";
import { bankFormatText } from "@/lib/midBank/validateQuestion";
import type { MidBankDetail } from "@/lib/midBank/clientTypes";

// One question bank's workspace - for its owner until the deadline. Anyone else
// who may see it (colleagues whose sections it covers), and the owner once it is
// locked, is sent to the read-only review.

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
    if (detail && !detail.access.canWrite) router.replace(`/panel/mid-bank/${encodeURIComponent(id)}/review`);
  }, [detail, id, router]);

  const back = <Button asChild variant="ghost" size="sm"><Link href="/panel/mid-bank"><ArrowLeft className="mr-1.5 h-4 w-4" />Question Bank</Link></Button>;
  if (error) return <div className="space-y-4">{back}<p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</p></div>;
  if (!detail || !detail.access.canWrite || !detail.outcomes) {
    return <div className="space-y-4"><div className="h-10 w-64 animate-pulse rounded bg-muted" /><div className="h-96 animate-pulse rounded-lg bg-muted" /></div>;
  }

  const { bank } = detail;
  const changeSections = `/panel/mid-bank/prepare?${new URLSearchParams({ deadlineId: bank.deadlineId, subjectId: bank.subjectId, branch: bank.branch })}`;
  return (
    <div className="space-y-6">
      <PageHeader
        title={`${bank.subjectName} - Mid ${bank.midNumber}`}
        description={`${bank.subjectCode} · ${bank.branch} · sections ${bank.sections.map((s) => s.sectionName).join(", ")} · Units ${bank.units.join(", ")} · ${bankFormatText(bank.format, bank.marks)}${detail.deadline ? ` · ${deadlineLabel(detail.deadline.deadline)}` : ""}`}
        actions={<div className="flex gap-2">{back}<Button asChild variant="outline" size="sm"><Link href={changeSections}>Sections &amp; setup</Link></Button></div>}
      />
      <BankWorkspace detail={detail} initialQ={q} />
    </div>
  );
}
