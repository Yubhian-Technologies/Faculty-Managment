"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { downloadCSV, toCSV } from "@/lib/utils/csv";
import type { ResultsAnalytics } from "@/lib/examResults/analytics";

// Results Analysis - the published semester results of one class (course +
// batch + semester), for one branch or all branches in scope. Shared by the
// Exam Cell, Principal / Vice Principal and HOD pages; the API decides which
// branches each may see.
//
// Charts are plain HTML bars, every one single-series: one blue for counts
// (light #2a78d6 / dark #3987e5) and the reserved status red only for failing
// grades, always labelled "Fail" - so nothing is told apart by shade alone.
// Every bar carries its value as text and a hover tooltip.

type ClassOption = { courseKey: string; courseName: string; batch: string; year: number; semester: number; branches: string[] };

const BAR = "bg-[#2a78d6] dark:bg-[#3987e5]";
const FAIL_BAR = "bg-[#d03b3b]";
// Not a value band (students the rules give no SGPA yet) - neutral, so it doesn't read as one.
const NEUTRAL_BAR = "bg-muted-foreground/35";
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none disabled:opacity-50";

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 1000) / 10 : 0);

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/** A hover tooltip for a bar - the bar's own element is the hit target. */
function Tip({ text }: { text: string }) {
  return (
    <span className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block">
      {text}
    </span>
  );
}

/** Vertical columns from a shared zero baseline, value above, label below. */
function Columns({ items }: { items: { label: string; value: number; fail?: boolean; neutral?: boolean; tip: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="flex h-56 items-end gap-2 border-b border-border/70 pt-6">
      {items.map((i) => (
        <div key={i.label} className="group relative flex h-full flex-1 flex-col items-center justify-end">
          <Tip text={i.tip} />
          <span className="mb-1 text-xs tabular-nums text-muted-foreground">{i.value}</span>
          <div className={`w-full max-w-12 rounded-t ${i.fail ? FAIL_BAR : i.neutral ? NEUTRAL_BAR : BAR}`} style={{ height: `${(i.value / max) * 100}%`, minHeight: i.value ? 2 : 0 }} />
        </div>
      ))}
    </div>
  );
}
function ColumnLabels({ items }: { items: { label: string; fail?: boolean }[] }) {
  return (
    <div className="flex gap-2 pt-1.5">
      {items.map((i) => (
        <div key={i.label} className="flex-1 text-center text-xs">
          <span className="font-medium">{i.label}</span>
          {i.fail && <span className="block text-[10px] text-muted-foreground">Fail</span>}
        </div>
      ))}
    </div>
  );
}

/** Branch comparison: one row per branch, pass % now as a bar, the other figures as columns. */
function BranchTable({ rows, fmt }: { rows: { branch: string; appeared: number; passedRegular: number; passedNow: number; averageSgpa: number | null }[]; fmt: (v: number | null) => string }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr className="border-b">
          <th className="p-2">Branch</th><th className="p-2 w-1/2">Pass % now</th><th className="p-2 text-right">Passed</th>
          <th className="p-2 text-right">Regular pass %</th><th className="p-2 text-right">Avg SGPA</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => {
          const now = pct(b.passedNow, b.appeared);
          return (
            <tr key={b.branch} className="border-b last:border-0">
              <td className="p-2 font-medium">{b.branch}</td>
              <td className="p-2">
                <div className="group relative flex items-center gap-2">
                  <Tip text={`${b.branch}: ${b.passedNow} of ${b.appeared} have no backlog`} />
                  <div className="h-4 flex-1 rounded bg-muted/60"><div className={`h-full rounded ${BAR}`} style={{ width: `${now}%` }} /></div>
                  <span className="w-14 text-right text-xs tabular-nums">{now}%</span>
                </div>
              </td>
              <td className="p-2 text-right tabular-nums">{b.passedNow}/{b.appeared}</td>
              <td className="p-2 text-right tabular-nums">{pct(b.passedRegular, b.appeared)}%</td>
              <td className="p-2 text-right tabular-nums">{fmt(b.averageSgpa)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ResultsAnalysisView({ title = "Results Analysis", description }: { title?: string; description?: string }) {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classKey, setClassKey] = useState("");
  const [branch, setBranch] = useState("");
  const [data, setData] = useState<{ analytics: ResultsAnalytics; sheets: { id: string; title: string }[] } | null>(null);
  const [isLoadingClasses, setIsLoadingClasses] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/college/exam-results/analytics")
      .then((r) => r.json() as Promise<{ classes?: ClassOption[]; error?: string }>)
      .then((d) => {
        if (cancelled) return;
        const list = d.classes ?? [];
        setClasses(list);
        if (list.length > 0) setClassKey(`${list[0].courseKey}|${list[0].batch}|${list[0].semester}`);
      })
      .catch(() => { if (!cancelled) toast({ variant: "destructive", title: "Failed to load results" }); })
      .finally(() => { if (!cancelled) setIsLoadingClasses(false); });
    return () => { cancelled = true; };
  }, []);

  const picked = classes.find((c) => `${c.courseKey}|${c.batch}|${c.semester}` === classKey) ?? null;

  useEffect(() => {
    if (!picked) return;
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      try {
        const q = new URLSearchParams({ courseKey: picked.courseKey, batch: picked.batch, semester: String(picked.semester), ...(branch ? { department: branch } : {}) });
        const res = await fetch(`/api/college/exam-results/analytics?${q}`);
        const json = (await res.json()) as { analytics?: ResultsAnalytics; sheets?: { id: string; title: string }[]; error?: string };
        if (cancelled) return;
        if (!res.ok || !json.analytics) { toast({ variant: "destructive", title: json.error ?? "Failed to load results" }); setData(null); }
        else setData({ analytics: json.analytics, sheets: json.sheets ?? [] });
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load results" });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [picked, branch]);

  const a = data?.analytics;
  const d = a?.decimals ?? 2;
  const fmt = (v: number | null | undefined) => (v != null ? v.toFixed(d) : "–");
  const backlogRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (a?.backlogStudents ?? []).filter((s) => !q || s.rollNumber.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  }, [a, search]);

  function exportBacklogs() {
    if (!a || !picked) return;
    const rows = [["Roll No", "Name", "Branch", "Backlogs", "Subjects"], ...a.backlogStudents.map((s) => [
      s.rollNumber, s.name, s.branch, String(s.backlogs.length), s.backlogs.map((b) => `${b.subjectCode} ${b.subjectName}`).join("; "),
    ])];
    downloadCSV(toCSV(rows), `backlogs_${picked.batch}_sem${picked.semester}${branch ? `_${branch}` : ""}.csv`);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description ?? "Published semester results - pass percentages, SGPA, subject-wise performance, toppers and backlogs."} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5 lg:col-span-2">
          <Label htmlFor="ra-class">Class</Label>
          <select id="ra-class" className={selectClass} value={classKey} onChange={(e) => { setClassKey(e.target.value); setBranch(""); }} disabled={classes.length === 0}>
            {classes.length === 0 && <option value="">{isLoadingClasses ? "Loading…" : "No published results yet"}</option>}
            {classes.map((c) => {
              const k = `${c.courseKey}|${c.batch}|${c.semester}`;
              return <option key={k} value={k}>{c.courseName} · Batch {c.batch} · Year {c.year} · Semester {c.semester}</option>;
            })}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ra-branch">Branch</Label>
          <select id="ra-branch" className={selectClass} value={branch} onChange={(e) => setBranch(e.target.value)} disabled={!picked}>
            <option value="">{picked && picked.branches.length > 1 ? "All branches" : picked?.branches[0] ?? "All branches"}</option>
            {picked && picked.branches.length > 1 && picked.branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>

      {!picked ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {isLoadingClasses ? "Loading…" : "No published results yet. They appear here once the Exam Cell publishes a results sheet."}
        </div>
      ) : isLoading || !a ? (
        <div className="h-96 rounded-lg border bg-muted/30 animate-pulse" />
      ) : a.appeared === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">No Regular results for this selection.</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Students" value={String(a.appeared)} note="Sat the Regular exam" />
            <Tile label="Pass % now" value={`${pct(a.passedNow, a.appeared)}%`} note={`${a.passedNow} of ${a.appeared} have no backlog`} />
            <Tile label="Regular pass %" value={`${pct(a.passedRegular, a.appeared)}%`} note="Before supplementary / revaluation" />
            <Tile label="Average SGPA" value={fmt(a.averageSgpa)} note={`Of ${a.withSgpa} with an SGPA`} />
            <Tile label="Highest SGPA" value={fmt(a.highestSgpa)} note={a.toppers[0] ? a.toppers[0].rollNumber : undefined} />
            <Tile label="Backlogs" value={String(a.backlogSubjects)} note={`${a.studentsWithBacklogs} student${a.studentsWithBacklogs === 1 ? "" : "s"}`} />
          </div>

          {a.branches.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Branch comparison</CardTitle>
                <CardDescription>Pass % now = students with no backlog of this semester.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <BranchTable rows={a.branches} fmt={fmt} />
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Grade distribution</CardTitle>
                <CardDescription>Final grade of every subject result ({a.grades.reduce((n, x) => n + x.count, 0)} in all).</CardDescription>
              </CardHeader>
              <CardContent>
                <Columns items={a.grades.map((x) => ({ label: x.grade, value: x.count, fail: !x.isPass, tip: `${x.grade}${x.isPass ? "" : " (fail)"}: ${x.count}` }))} />
                <ColumnLabels items={a.grades.map((x) => ({ label: x.grade, fail: !x.isPass }))} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">SGPA bands</CardTitle>
                <CardDescription>Students by SGPA. &ldquo;Withheld&rdquo; = not shown yet under the college&rsquo;s rules (a subject still to pass).</CardDescription>
              </CardHeader>
              <CardContent>
                <Columns items={a.sgpaBands.map((b) => ({ label: b.label, value: b.count, neutral: b.label === "Withheld", tip: `SGPA ${b.label}: ${b.count} student${b.count === 1 ? "" : "s"}` }))} />
                <ColumnLabels items={a.sgpaBands.map((b) => ({ label: b.label }))} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Subject-wise results</CardTitle>
              <CardDescription>Regular pass % is the first attempt; pass % now includes supplementaries and revaluations.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="p-2">Code</th><th className="p-2">Subject</th><th className="p-2 text-right">Credits</th><th className="p-2 text-right">Appeared</th>
                    <th className="p-2 text-right">Regular pass %</th><th className="p-2 w-48">Pass % now</th><th className="p-2 text-right">Avg points</th><th className="p-2">Grades</th>
                  </tr>
                </thead>
                <tbody>
                  {[...a.subjects].sort((x, y) => pct(x.passedNow, x.appeared) - pct(y.passedNow, y.appeared)).map((s) => {
                    const now = pct(s.passedNow, s.appeared);
                    return (
                      <tr key={s.subjectCode} className="border-b last:border-0">
                        <td className="p-2 font-mono text-xs">{s.subjectCode}</td>
                        <td className="p-2">{s.subjectName}</td>
                        <td className="p-2 text-right tabular-nums">{s.credits}</td>
                        <td className="p-2 text-right tabular-nums">{s.appeared}</td>
                        <td className="p-2 text-right tabular-nums">{pct(s.passedRegular, s.appeared)}%</td>
                        <td className="p-2">
                          <div className="group relative flex items-center gap-2">
                            <Tip text={`${s.passedNow} of ${s.appeared} passed`} />
                            <div className="h-3 flex-1 rounded bg-muted/60"><div className={`h-full rounded ${BAR}`} style={{ width: `${now}%` }} /></div>
                            <span className="w-12 text-right text-xs tabular-nums">{now}%</span>
                          </div>
                        </td>
                        <td className="p-2 text-right tabular-nums">{s.averagePoints.toFixed(2)}</td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {Object.entries(s.grades).sort((x, y) => (a.grades.findIndex((g) => g.grade === x[0])) - (a.grades.findIndex((g) => g.grade === y[0]))).map(([g, n]) => `${g} ${n}`).join(" · ")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">Sorted by pass % now, lowest first.</p>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Toppers</CardTitle>
                <CardDescription>Highest SGPA this semester.</CardDescription>
              </CardHeader>
              <CardContent>
                {a.toppers.length === 0 ? <p className="text-sm text-muted-foreground">No SGPA to rank yet.</p> : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="p-2">#</th><th className="p-2">Roll No</th><th className="p-2">Name</th><th className="p-2">Branch</th><th className="p-2 text-right">SGPA</th></tr></thead>
                    <tbody>
                      {a.toppers.map((t, i) => (
                        <tr key={t.studentId} className="border-b last:border-0">
                          <td className="p-2 tabular-nums">{i + 1}</td><td className="p-2">{t.rollNumber}</td><td className="p-2">{t.name}</td>
                          <td className="p-2 text-muted-foreground">{t.branch}</td><td className="p-2 text-right font-semibold tabular-nums">{fmt(t.sgpa)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">Students with backlogs</CardTitle>
                  <CardDescription>{a.studentsWithBacklogs} student{a.studentsWithBacklogs === 1 ? "" : "s"}, most backlogs first.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={exportBacklogs} disabled={a.studentsWithBacklogs === 0}>
                  <Download className="mr-1.5 h-4 w-4" />CSV
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {a.studentsWithBacklogs === 0 ? <p className="text-sm text-muted-foreground">No backlogs.</p> : (
                  <>
                    <Input placeholder="Search by Roll No or name" value={search} onChange={(e) => setSearch(e.target.value)} />
                    <div className="max-h-80 overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground"><tr className="border-b"><th className="p-2">Roll No</th><th className="p-2">Name</th><th className="p-2">Subjects</th></tr></thead>
                        <tbody>
                          {backlogRows.map((s) => (
                            <tr key={s.studentId} className="border-b last:border-0 align-top">
                              <td className="p-2">{s.rollNumber}</td>
                              <td className="p-2">{s.name}<span className="block text-xs text-muted-foreground">{s.branch}</span></td>
                              <td className="p-2 text-xs">{s.backlogs.map((b) => b.subjectCode).join(", ")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {data && data.sheets.length > 0 && (
            <p className="text-xs text-muted-foreground">From: {data.sheets.map((s) => s.title).join(" | ")}</p>
          )}
        </>
      )}
    </div>
  );
}
