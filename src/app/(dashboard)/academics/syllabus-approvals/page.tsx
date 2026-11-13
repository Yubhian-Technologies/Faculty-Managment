"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SYLLABUS_STATUS_LABEL } from "@/lib/subjects/syllabus";
import type { SubjectSyllabusStatus } from "@/types";

// Academics (Dean Academics): the subject syllabi the HODs prepare - waiting to be frozen first, then frozen,
// returned and drafts. Each opens the syllabus to freeze / return it, or (frozen) to change it with a record.

interface Item {
  subjectId: string; subjectName: string; subjectCode: string; courseName: string; regulation: string;
  status: SubjectSyllabusStatus; units: number; cos: number;
  submittedAt: string | null; submittedByName: string | null; frozenAt: string | null; frozenByName: string | null; updatedAt: string; returnRemarks: string | null;
}

const TABS: { key: SubjectSyllabusStatus; label: string }[] = [
  { key: "SUBMITTED", label: "To freeze" },
  { key: "FROZEN", label: "Frozen" },
  { key: "RETURNED", label: "Returned" },
  { key: "DRAFT", label: "Drafts (HOD)" },
];
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export default function SyllabusApprovalsPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<SubjectSyllabusStatus>("SUBMITTED");

  useEffect(() => {
    fetch("/api/college/syllabus-approvals")
      .then(async (r) => { const d = (await r.json()) as { items?: Item[]; error?: string }; if (!r.ok) throw new Error(d.error ?? "Unable to load"); setItems(d.items ?? []); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Unable to load"));
  }, []);

  const count = (k: SubjectSyllabusStatus) => (items ?? []).filter((i) => i.status === k).length;
  const shown = useMemo(() => (items ?? []).filter((i) => i.status === tab), [items, tab]);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Syllabus Approvals" description="The HODs prepare each subject's syllabus (units, COs, CO-PO mapping) and submit it here. Freeze it, or return it with remarks. Once frozen only you can change it, and every change is recorded." />
      {error && <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</p>}

      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cn("rounded-full border px-4 py-1.5 text-sm font-medium", tab === t.key ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>
            {t.label} ({count(t.key)})
          </button>
        ))}
      </div>

      {items === null && !error ? (
        <div className="h-32 animate-pulse rounded-2xl border bg-muted/30" />
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nothing here.</p>
      ) : (
        <Card className="overflow-hidden rounded-2xl">
          <CardContent className="divide-y p-0">
            {shown.map((i) => (
              <Link key={i.subjectId} href={`/academics/syllabus-approvals/${encodeURIComponent(i.subjectId)}`} className="flex items-center gap-3 p-4 hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{i.subjectName} <span className="font-mono text-xs text-muted-foreground">{i.subjectCode}</span></p>
                  <p className="text-xs text-muted-foreground">
                    {[i.courseName, i.regulation, `${i.units} units`, `${i.cos} COs`].filter(Boolean).join(" · ")}
                    {i.status === "SUBMITTED" && i.submittedAt ? ` · submitted by ${i.submittedByName} on ${when(i.submittedAt)}` : ""}
                    {i.status === "FROZEN" && i.frozenAt ? ` · frozen by ${i.frozenByName} on ${when(i.frozenAt)}` : ""}
                    {i.status === "RETURNED" && i.returnRemarks ? ` · ${i.returnRemarks}` : ""}
                  </p>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">{SYLLABUS_STATUS_LABEL[i.status]}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
