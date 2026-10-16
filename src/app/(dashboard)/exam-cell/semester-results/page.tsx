"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Send, Settings2, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import type { ExamResultBatch } from "@/types/examResults";

// Every results sheet the Exam Cell has imported, newest first. One every-branch upload
// makes a draft sheet per branch (same uploadId): those can be published or deleted together.

function when(value: unknown): string {
  const v = value as { _seconds?: number; seconds?: number } | string | null | undefined;
  const secs = typeof v === "object" && v ? v._seconds ?? v.seconds : undefined;
  const d = secs != null ? new Date(secs * 1000) : typeof v === "string" ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
}

export default function SemesterResultsPage() {
  const [batches, setBatches] = useState<ExamResultBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [confirm, setConfirm] = useState<null | { action: "publish" | "delete"; uploadId: string }>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/college/exam-results/batches")
      .then((r) => r.json() as Promise<{ batches?: ExamResultBatch[] }>)
      .then((d) => setBatches(d.batches ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load results" }))
      .finally(() => setIsLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Uploads that still have two or more draft sheets.
  const uploads = useMemo(() => {
    const byUpload = new Map<string, ExamResultBatch[]>();
    for (const b of batches) {
      if (!b.uploadId || b.status !== "DRAFT") continue;
      byUpload.set(b.uploadId, [...(byUpload.get(b.uploadId) ?? []), b]);
    }
    return [...byUpload.entries()].filter(([, list]) => list.length > 1).map(([uploadId, sheets]) => ({ uploadId, sheets }));
  }, [batches]);
  const picked = confirm ? uploads.find((u) => u.uploadId === confirm.uploadId) ?? null : null;

  // One sheet at a time through the same per-sheet publish / delete; a refused sheet is
  // reported and the rest carry on.
  async function runAll() {
    if (!confirm || !picked) return;
    setBusy(true);
    const failed: string[] = [];
    for (const b of picked.sheets) {
      try {
        const res = await fetch(`/api/college/exam-results/batches/${encodeURIComponent(b.id)}`, confirm.action === "publish"
          ? { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "publish" }) }
          : { method: "DELETE" });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          failed.push(`${b.subDepartment || b.department}: ${json.error ?? "failed"}`);
        }
      } catch {
        failed.push(`${b.subDepartment || b.department}: network error`);
      }
    }
    const done = picked.sheets.length - failed.length;
    const verb = confirm.action === "publish" ? "Published" : "Deleted";
    toast(failed.length
      ? { variant: "destructive", title: `${verb} ${done} of ${picked.sheets.length} sheets`, description: failed.join(" · ") }
      : { variant: "success", title: `${verb} ${done} sheets` });
    setBusy(false);
    setConfirm(null);
    load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Semester Results"
        description="Results sheets imported by the Exam Cell. Drafts are visible only here; published results are locked."
        actions={
          <>
            <Button variant="outline" asChild><Link href="/exam-cell/result-rules"><Settings2 className="mr-1.5 h-4 w-4" />Result Rules</Link></Button>
            <Button asChild><Link href="/exam-cell/semester-results/import"><Plus className="mr-1.5 h-4 w-4" />Import results</Link></Button>
          </>
        }
      />

      {isLoading ? (
        <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
      ) : batches.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No results imported yet. Check the grade table under Result Rules, then use Import results.
        </div>
      ) : (
        <>
        {uploads.map(({ uploadId, sheets }) => (
          <div key={uploadId} className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 p-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium">One upload: {sheets.length} draft sheets · {sheets.reduce((n, b) => n + (b.studentCount ?? 0), 0)} students</p>
              <p className="text-xs text-muted-foreground">{sheets.map((b) => `${b.subDepartment || b.department} (${b.studentCount})`).join(" · ")}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setConfirm({ action: "delete", uploadId })}><Trash2 className="mr-1.5 h-4 w-4" />Delete all</Button>
            <Button size="sm" onClick={() => setConfirm({ action: "publish", uploadId })}><Send className="mr-1.5 h-4 w-4" />Publish all</Button>
          </div>
        ))}
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Results sheet</th><th className="p-3">Status</th><th className="p-3 text-right">Students</th>
                <th className="p-3 text-right">Subject results</th><th className="p-3">Imported</th><th className="p-3">Published</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-t hover:bg-muted/30">
                  <td className="p-3"><Link className="font-medium text-primary hover:underline" href={`/exam-cell/semester-results/${b.id}`}>{b.title}</Link></td>
                  <td className="p-3"><Badge variant={b.status === "PUBLISHED" ? "default" : "secondary"}>{b.status === "PUBLISHED" ? "Published" : "Draft"}</Badge></td>
                  <td className="p-3 text-right">{b.studentCount}</td>
                  <td className="p-3 text-right">{b.subjectRowCount}</td>
                  <td className="p-3 text-xs text-muted-foreground">{when(b.createdAt)} · {b.createdByName}</td>
                  <td className="p-3 text-xs text-muted-foreground">{b.status === "PUBLISHED" ? `${when(b.publishedAt)} · ${b.publishedByName ?? ""}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      <ConfirmDialog
        open={confirm?.action === "publish"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Publish all ${picked?.sheets.length ?? 0} sheets?`}
        description="Every branch's results in this upload become visible and are locked. Open a sheet first to check for missing students or odd credit totals."
        confirmLabel="Publish all"
        loading={busy}
        onConfirm={runAll}
      />
      <ConfirmDialog
        open={confirm?.action === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete all ${picked?.sheets.length ?? 0} draft sheets?`}
        description="Removes these drafts and every result in them. Nothing published is affected."
        confirmLabel="Delete all"
        variant="destructive"
        loading={busy}
        onConfirm={runAll}
      />
    </div>
  );
}
