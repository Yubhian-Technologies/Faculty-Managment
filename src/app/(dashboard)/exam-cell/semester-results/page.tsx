"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import type { ExamResultBatch } from "@/types/examResults";

// Every results sheet the Exam Cell has imported, newest first.

function when(value: unknown): string {
  const v = value as { _seconds?: number; seconds?: number } | string | null | undefined;
  const secs = typeof v === "object" && v ? v._seconds ?? v.seconds : undefined;
  const d = secs != null ? new Date(secs * 1000) : typeof v === "string" ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
}

export default function SemesterResultsPage() {
  const [batches, setBatches] = useState<ExamResultBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/exam-results/batches")
      .then((r) => r.json() as Promise<{ batches?: ExamResultBatch[] }>)
      .then((d) => setBatches(d.batches ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load results" }))
      .finally(() => setIsLoading(false));
  }, []);

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
      )}
    </div>
  );
}
