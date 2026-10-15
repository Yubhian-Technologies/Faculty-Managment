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
  // Regular sheets: students of the batch + branch with no result in this sheet.
  const [missing, setMissing] = useState<{ rollNumber: string; name: string }[]>([]);
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
        .then((x) => x.json() as Promise<{ batch?: ExamResultBatch; records?: ExamResultRecord[]; standings?: Record<string, StudentStanding>; rules?: ExamResultRules; missing?: { rollNumber: string; name: string }[]; error?: string }>);
      if (cancelled) return;
      if (!b.batch) { toast({ variant: "destructive", title: b.error ?? "Results sheet not found" }); return; }
      setBatch(b.batch);
      setRecords(b.records ?? []);
      setStandings(b.standings ?? {});
      setMissing(b.missing ?? []);
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

  // ── Checks before Publish (warnings only) ──
  // 1. Our SGPA against the university's, where the file gave one ("-" = withheld).
  const hasUniversitySgpa = records.some((r) => r.universitySgpa !== undefined);
  const sgpaDiffers = (r: ExamResultRecord): boolean => {
    if (r.universitySgpa === undefined) return false;
    const ours = standings[r.id]?.sgpa ?? null;
    if (r.universitySgpa === null) return ours !== null;
    return ours === null || Math.abs(Math.round(ours * 100) / 100 - r.universitySgpa) > 0.005;
  };
  const sgpaMismatches = useMemo(() => records.filter(sgpaDiffers), [records, standings]); // eslint-disable-line react-hooks/exhaustive-deps
  // 2. Credits: on a Regular sheet every student takes the same subjects, so a
  //    student whose credit total differs from most is missing (or has an extra) subject.
  const creditCheck = useMemo(() => {
    if (batch?.examType !== "REGULAR" || records.length === 0) return null;
    const totalOf = (r: ExamResultRecord) => r.subjects.filter((x) => x.credits > 0).reduce((n, x) => n + x.credits, 0);
    const counts = new Map<number, number>();
    for (const r of records) counts.set(totalOf(r), (counts.get(totalOf(r)) ?? 0) + 1);
    const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { usual, odd: records.filter((r) => totalOf(r) !== usual).map((r) => ({ rollNumber: r.rollNumber, credits: totalOf(r) })) };
  }, [batch, records]);

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

      {batch && records.length > 0 && (
        <div className="space-y-2 rounded-lg border p-4">
          <p className="text-sm font-semibold">Checks{isDraft ? " before publishing" : ""}</p>
          <ul className="space-y-1.5 text-sm">
            <li>
              {!hasUniversitySgpa
                ? <span className="text-muted-foreground">University SGPA: not in the file - add a &ldquo;University SGPA&rdquo; column to compare.</span>
                : sgpaMismatches.length === 0
                  ? <span className="text-emerald-700 dark:text-emerald-400">✓ Every SGPA matches the university&rsquo;s.</span>
                  : <span className="text-destructive">✗ {sgpaMismatches.length} student{sgpaMismatches.length > 1 ? "s'" : "'s"} SGPA differs from the university&rsquo;s: {sgpaMismatches.slice(0, 15).map((r) => `${r.rollNumber} (ours ${fmt(standings[r.id]?.sgpa)}, university ${r.universitySgpa ?? "–"})`).join(", ")}{sgpaMismatches.length > 15 ? " …" : ""} - usually a grade against the wrong subject, or a subject&rsquo;s credits.</span>}
            </li>
            {batch.examType === "REGULAR" && (
              <li>
                {missing.length === 0
                  ? <span className="text-emerald-700 dark:text-emerald-400">✓ Every student of {batch.department} {batch.batch} has a result.</span>
                  : <span className="text-amber-700 dark:text-amber-400">! {missing.length} student{missing.length > 1 ? "s" : ""} of {batch.department} {batch.batch} {missing.length > 1 ? "have" : "has"} no result here: {missing.slice(0, 15).map((m) => m.rollNumber).join(", ")}{missing.length > 15 ? " …" : ""}{isDraft ? " - use Add rows if they were left out." : "."}</span>}
              </li>
            )}
            {creditCheck && (
              <li>
                {creditCheck.odd.length === 0
                  ? <span className="text-emerald-700 dark:text-emerald-400">✓ Every student has {creditCheck.usual} credits.</span>
                  : <span className="text-amber-700 dark:text-amber-400">! Most students have {creditCheck.usual} credits, but {creditCheck.odd.slice(0, 15).map((o) => `${o.rollNumber} has ${o.credits}`).join(", ")}{creditCheck.odd.length > 15 ? " …" : ""} - a subject row may be missing.</span>}
              </li>
            )}
          </ul>
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
                <th className="p-2 text-right">SGPA</th>
                {hasUniversitySgpa && <th className="p-2 text-right">University SGPA</th>}
                <th className="p-2 text-right">CGPA</th>
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
                    {hasUniversitySgpa && (
                      <td className={`p-2 text-right ${sgpaDiffers(r) ? "font-semibold text-destructive" : "text-muted-foreground"}`} title={sgpaDiffers(r) ? "Differs from the system's SGPA" : undefined}>
                        {r.universitySgpa === undefined ? "" : r.universitySgpa === null ? "–" : r.universitySgpa.toFixed(2)}
                      </td>
                    )}
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
