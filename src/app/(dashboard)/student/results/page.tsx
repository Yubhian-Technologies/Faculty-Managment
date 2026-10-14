"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { StudentAttempt, StudentResultsView } from "@/lib/examResults/studentResults";
import { examHeldLabel } from "@/lib/examResults/sheet";
import type { GpaShowRule } from "@/types/examResults";

// The student's own semester results: one card per semester with each
// subject's latest grade (and earlier attempts), SGPA and CGPA - "–" when the
// college withholds them until a backlog is cleared.

function attemptLabel(a: StudentAttempt): string {
  // "Nov 2026" - the exam month, as on the grade memo (the academic year for an older record without one).
  const when = examHeldLabel(a.examHeld) || a.academicYear;
  if (a.examType === "REVALUATION") return `Revaluation of ${a.revaluationOf === "SUPPLEMENTARY" ? "Supplementary" : "Regular"} ${when}`;
  return `${a.examType === "SUPPLEMENTARY" ? "Supplementary" : "Regular"} ${when}`;
}

type Payload = { results: StudentResultsView; rules: { showSgpa: GpaShowRule; showCgpa: GpaShowRule } };

function Figure({ label, value, withheld, decimals, hint }: { label: string; value: number | null; withheld: boolean; decimals: number; hint: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value != null ? value.toFixed(decimals) : "–"}</p>
      {withheld && <p className="text-xs text-amber-700 dark:text-amber-400">{hint}</p>}
    </div>
  );
}

export default function StudentResultsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/college/student/me/results");
        const json = (await res.json()) as Partial<Payload> & { error?: string };
        if (cancelled) return;
        if (!res.ok || !json.results) setError(json.error ?? "Couldn't load your results.");
        else setData(json as Payload);
      } catch {
        if (!cancelled) setError("Couldn't load your results.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const r = data?.results;
  const d = r?.decimals ?? 2;

  return (
    <div className="space-y-6">
      <PageHeader title="Results" description="Your published semester results, SGPA and CGPA. After a revaluation the better of the two grades counts." />

      {isLoading ? (
        <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
      ) : error ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{error}</div>
      ) : !r || r.semesters.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No results have been published for you yet.</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Figure label="CGPA" value={r.cgpa} withheld={r.cgpaWithheld} decimals={d} hint="Shown once every subject so far is passed." />
            <div className="rounded-lg border bg-muted/30 px-4 py-3">
              <p className="text-xs text-muted-foreground">Credits earned</p>
              <p className="text-2xl font-semibold">{r.creditsEarned}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 px-4 py-3">
              <p className="text-xs text-muted-foreground">Backlogs</p>
              <p className={`text-2xl font-semibold ${r.backlogs.length ? "text-destructive" : ""}`}>{r.backlogs.length}</p>
              {r.backlogs.length > 0 && (
                <p className="text-xs text-muted-foreground">{r.backlogs.map((b) => `${b.subjectCode} (Sem ${b.semester})`).join(", ")}</p>
              )}
            </div>
          </div>

          {[...r.semesters].reverse().map((s) => (
            <Card key={s.semester}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
                <CardTitle className="text-base">Year {s.year} · Semester {s.semester}</CardTitle>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Badge variant="secondary">SGPA {s.sgpa != null ? s.sgpa.toFixed(d) : "–"}</Badge>
                  <Badge variant="secondary">CGPA {s.cgpa != null ? s.cgpa.toFixed(d) : "–"}</Badge>
                  {s.backlogs.length > 0 && <Badge variant="destructive">{s.backlogs.length} backlog{s.backlogs.length > 1 ? "s" : ""}</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr><th className="p-2">Code</th><th className="p-2">Subject</th><th className="p-2 text-right">Credits</th><th className="p-2 text-center">Grade</th><th className="p-2">Result</th></tr>
                    </thead>
                    <tbody>
                      {s.subjects.map((x) => {
                        return (
                          <tr key={x.subjectCode} className="border-t align-top">
                            <td className="p-2 font-mono text-xs">{x.subjectCode}</td>
                            <td className="p-2">
                              {x.subjectName}
                              {x.attempts.length > 1 && (
                                <p className="text-xs text-muted-foreground">
                                  {x.attempts.map((a) => `${attemptLabel(a)}: ${a.grade}${a.examType === "REVALUATION" ? (a.improved ? " (counted)" : " (original kept)") : ""}`).join(" · ")}
                                </p>
                              )}
                            </td>
                            <td className="p-2 text-right">{x.credits}</td>
                            <td className={`p-2 text-center font-semibold ${x.isPass ? "" : "text-destructive"}`}>{x.grade}</td>
                            <td className="p-2">{x.isPass ? <span className="text-emerald-700 dark:text-emerald-400">Pass</span> : <span className="text-destructive">Fail</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {(s.sgpaWithheld || s.cgpaWithheld) && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {s.sgpaWithheld ? "SGPA is shown once every subject of this semester is passed. " : ""}
                    {s.cgpaWithheld ? "CGPA is shown once every subject up to this semester is passed." : ""}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
