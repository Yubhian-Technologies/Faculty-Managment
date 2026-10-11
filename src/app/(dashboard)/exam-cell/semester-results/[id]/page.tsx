"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Send, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import type { StudentStanding } from "@/lib/examResults/gpa";
import type { ExamResultBatch, ExamResultRecord, ExamResultRules } from "@/types/examResults";

// One results sheet: every student's grades, and their SGPA for this semester
// and CGPA up to it - worked out by the server from their published results
// plus this sheet, under the college's own show rules ("–" when withheld).

export default function SemesterResultBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [batch, setBatch] = useState<ExamResultBatch | null>(null);
  const [records, setRecords] = useState<ExamResultRecord[]>([]);
  const [rules, setRules] = useState<ExamResultRules | null>(null);
  const [standings, setStandings] = useState<Record<string, StudentStanding>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<null | "publish" | "delete">(null);
  const [busy, setBusy] = useState(false);

  // Bumped after a publish to read the sheet again.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
    try {
      const b = await fetch(`/api/college/exam-results/batches/${encodeURIComponent(id)}`)
        .then((x) => x.json() as Promise<{ batch?: ExamResultBatch; records?: ExamResultRecord[]; standings?: Record<string, StudentStanding>; rules?: ExamResultRules; error?: string }>);
      if (cancelled) return;
      if (!b.batch) { toast({ variant: "destructive", title: b.error ?? "Results sheet not found" }); return; }
      setBatch(b.batch);
      setRecords(b.records ?? []);
      setStandings(b.standings ?? {});
      setRules(b.rules ?? null);
    } catch {
      if (!cancelled) toast({ variant: "destructive", title: "Failed to load results" });
    } finally {
      if (!cancelled) setIsLoading(false);
    }
    })();
    return () => { cancelled = true; };
  }, [id, reloadKey]);

  const codes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of records) for (const s of r.subjects) if (!seen.has(s.subjectCode)) seen.set(s.subjectCode, s.subjectName);
    // The order of the uploaded sheet (each student's subjects are stored in
    // their row order), never re-sorted by code.
    return [...seen.entries()];
  }, [records]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records
      .filter((r) => !q || r.rollNumber.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      .map((r) => ({ r, gpa: standings[r.id] }));
  }, [records, search, standings]);
  const fmt = (v: number | null | undefined) => (v != null ? v.toFixed(rules?.decimals ?? 2) : "–");
  const failedCount = useMemo(() => records.filter((r) => r.subjects.some((s) => !s.isPass)).length, [records]);

  async function publish() {
    setBusy(true);
    try {
      const res = await fetch(`/api/college/exam-results/batches/${encodeURIComponent(id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "publish" }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Could not publish" }); return; }
      toast({ variant: "success", title: "Results published" });
      setConfirm(null);
      setReloadKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/college/exam-results/batches/${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Could not delete" }); return; }
      toast({ variant: "success", title: "Draft deleted" });
      router.push("/exam-cell/semester-results");
    } finally {
      setBusy(false);
    }
  }

  const isDraft = batch?.status === "DRAFT";

  return (
    <div className="space-y-6">
      <PageHeader
        title={batch?.title ?? "Results"}
        description={batch ? `${batch.studentCount} students · ${batch.subjectRowCount} subject results · ${failedCount} with a failed subject` : undefined}
        actions={
          <>
            <Button variant="outline" asChild><Link href="/exam-cell/semester-results"><ArrowLeft className="mr-1.5 h-4 w-4" />All results</Link></Button>
            {isDraft && (
              <>
                <Button variant="outline" asChild><Link href={`/exam-cell/semester-results/import?batchId=${encodeURIComponent(id)}`}><Plus className="mr-1.5 h-4 w-4" />Add rows</Link></Button>
                <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirm("delete")}><Trash2 className="mr-1.5 h-4 w-4" />Delete draft</Button>
                <Button onClick={() => setConfirm("publish")} disabled={records.length === 0}><Send className="mr-1.5 h-4 w-4" />Publish</Button>
              </>
            )}
          </>
        }
      />

      {batch && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={isDraft ? "secondary" : "default"}>{isDraft ? "Draft - visible only to the Exam Cell" : "Published - locked"}</Badge>
          {rules && (
            <span className="text-xs text-muted-foreground">
              SGPA: {rules.showSgpa === "ALL_PASSED" ? "only when the semester is fully passed" : "always"} · CGPA: {rules.showCgpa === "ALL_PASSED" ? "only when every semester so far is passed" : "always"} · from published results plus this sheet. &ldquo;–&rdquo; = withheld.
            </span>
          )}
        </div>
      )}

      <Input placeholder="Search by Roll No or name" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />

      {isLoading ? (
        <div className="h-96 rounded-lg border bg-muted/30 animate-pulse" />
      ) : records.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">No students in this sheet.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="p-2">Roll No</th><th className="p-2">Name</th><th className="p-2">Department</th>
                {codes.map(([code, name]) => <th key={code} className="p-2 text-center" title={name}>{code}</th>)}
                <th className="p-2 text-right">SGPA</th><th className="p-2 text-right">CGPA</th>
                <th className="p-2">Backlogs (all semesters)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, gpa }) => {
                const bySubject = new Map(r.subjects.map((s) => [s.subjectCode, s]));
                return (
                  <tr key={r.id} className="border-t">
                    <td className="p-2 font-medium">{r.rollNumber}</td>
                    <td className="p-2">{r.name}</td>
                    <td className="p-2 text-muted-foreground">{r.department}</td>
                    {codes.map(([code]) => {
                      const s = bySubject.get(code);
                      return (
                        <td key={code} className={`p-2 text-center ${s && !s.isPass ? "font-semibold text-destructive" : ""}`} title={s ? `${s.credits} credits · ${s.points} points` : undefined}>
                          {s?.grade ?? ""}
                        </td>
                      );
                    })}
                    <td className="p-2 text-right font-medium" title={gpa?.sgpaWithheld ? "Withheld until the semester is fully passed" : undefined}>{fmt(gpa?.sgpa)}</td>
                    <td className="p-2 text-right font-medium" title={gpa?.cgpaWithheld ? "Withheld until every semester so far is passed" : undefined}>{fmt(gpa?.cgpa)}</td>
                    <td className="p-2 text-destructive">{(gpa?.backlogs ?? []).join(", ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirm === "publish"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Publish these results?"
        description={`${records.length} students' results become visible and are locked. Corrections after this need a separate revaluation edit.`}
        confirmLabel="Publish"
        loading={busy}
        onConfirm={publish}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this draft?"
        description="Removes the draft and every result in it. Nothing published is affected."
        confirmLabel="Delete draft"
        variant="destructive"
        loading={busy}
        onConfirm={remove}
      />
    </div>
  );
}
