"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, CalendarClock, FileText, GraduationCap, Layers, Settings2, Users, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BankWorkspace } from "@/components/midBank/BankWorkspace";
import { daysLeft, deadlineLabel } from "@/lib/midBank/deadline";
import { allowedFormats, bankFormatText } from "@/lib/midBank/validateQuestion";
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
  const left = detail.deadline ? daysLeft(detail.deadline.deadline) : null;
  const facts: [LucideIcon, string][] = [
    [GraduationCap, bank.branch],
    [Users, `Section${bank.sections.length === 1 ? "" : "s"} ${bank.sections.map((s) => s.sectionName).join(", ")}`],
    [Layers, `Units ${bank.units.join(", ")}`],
    [FileText, bankFormatText(allowedFormats(bank), bank.marks)],
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {back}
        <Button asChild variant="outline" size="sm"><Link href={changeSections}><Settings2 className="mr-1.5 h-4 w-4" />Sections &amp; setup</Link></Button>
      </div>
      <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-5 text-primary-foreground shadow-md sm:p-6">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-white/10" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5"><BookOpen className="h-3.5 w-3.5" />{bank.subjectCode}</span>
              <span className="rounded-full bg-white/20 px-2.5 py-0.5">Mid {bank.midNumber}</span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{bank.subjectName}</h1>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm opacity-95">
              {facts.map(([Icon, text]) => <li key={text} className="flex items-center gap-1.5"><Icon className="h-4 w-4 opacity-80" />{text}</li>)}
            </ul>
          </div>
          {detail.deadline && (
            <div className="rounded-xl bg-white px-4 py-3 text-right text-primary shadow-sm">
              <p className="flex items-center justify-end gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" />Deadline</p>
              <p className="text-lg font-bold leading-tight">{left === 0 ? "Due today" : left === 1 ? "1 day left" : left !== null && left > 1 ? `${left} days left` : deadlineLabel(detail.deadline.deadline)}</p>
              <p className="text-xs text-muted-foreground">{deadlineLabel(detail.deadline.deadline)}</p>
            </div>
          )}
        </div>
      </header>
      <BankWorkspace detail={detail} initialQ={q} />
    </div>
  );
}
