"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Student > Mid Marks: my Mid exam marks per subject, once the Exam Cell freezes them - each part (Descriptive, Quiz,
// Course Activity ...) and the written questions box by box ("-" = not attempted) with their CO.

interface Part { id: string; name: string; max: number; marks: number | "AB" | null; boxes: { label: string; max: number; value: number | string; co?: string }[]; items: boolean }
interface Mid { midNumber: number; outOf: number; total: number | null; absent: boolean; parts: Part[] }
interface Subject { subjectId: string; code: string; name: string; mids: Mid[] }

export default function StudentMidMarksPage() {
  const [d, setD] = useState<Subject[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/college/student/me/mid-marks")
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Unable to load your Mid marks."); setD(j.subjects); })
      .catch((e: Error) => setError(e.message));
  }, []);
  const mids = [...new Set((d ?? []).flatMap((s) => s.mids.map((m) => m.midNumber)))].sort((a, b) => a - b);

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Mid Marks" description="Your Mid exam marks, subject by subject. They appear once the Exam Cell finalizes them." />
      {error ? <p className="text-sm text-destructive">{error}</p> : !d ? <div className="h-40 animate-pulse rounded-2xl bg-muted/40" /> : d.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Mid marks yet.</p>
      ) : mids.map((mid) => (
        <section key={mid} className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><span className="rounded-md bg-primary px-2 py-0.5 text-xs text-primary-foreground">Mid-{mid}</span></h2>
          {d.filter((s) => s.mids.some((m) => m.midNumber === mid)).map((s) => {
            const m = s.mids.find((x) => x.midNumber === mid)!;
            const key = `${s.subjectId}|${mid}`;
            const written = m.parts.filter((p) => p.boxes.length && !p.items);
            const expand = open === key;
            return (
              <Card key={key} className="rounded-2xl"><CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{s.name} <span className="font-mono text-xs text-muted-foreground">{s.code}</span></p>
                  <p className="text-sm">{m.absent ? <span className="font-semibold text-amber-700 dark:text-amber-300">Absent</span> : <><span className="text-lg font-semibold tabular-nums">{m.total ?? "-"}</span><span className="text-muted-foreground"> / {m.outOf}</span></>}</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {m.parts.map((p) => (
                    <div key={p.id} className="rounded-lg border px-3 py-2">
                      <p className="text-xs text-muted-foreground">{p.name}</p>
                      <p className="tabular-nums">{p.marks === "AB" ? <span className="font-semibold text-amber-700 dark:text-amber-300">AB</span> : <span className="font-semibold">{p.marks ?? "-"}</span>}<span className="text-xs text-muted-foreground"> / {p.max}</span></p>
                    </div>
                  ))}
                </div>
                {written.length > 0 && (
                  <div>
                    <button type="button" onClick={() => setOpen(expand ? null : key)} className="flex items-center gap-1 text-xs font-medium text-primary">
                      Question-wise Marks<ChevronDown className={cn("h-3.5 w-3.5 transition", expand && "rotate-180")} />
                    </button>
                    {expand && written.map((p) => (
                      <div key={p.id} className="mt-2 overflow-x-auto">
                        <p className="mb-1 text-xs text-muted-foreground">{p.name}</p>
                        <table className="text-sm">
                          <tbody>
                            <tr className="text-xs text-muted-foreground">{p.boxes.map((b) => <th key={b.label} className="px-2 py-1 text-center font-medium">{b.label}{b.co && <span className="block text-[10px] font-normal">{b.co}</span>}</th>)}</tr>
                            <tr>{p.boxes.map((b) => <td key={b.label} className={cn("border px-2 py-1 text-center tabular-nums", b.value === "-" && "text-muted-foreground")}>{b.value}</td>)}</tr>
                          </tbody>
                        </table>
                      </div>
                    ))}
                    {expand && <p className="mt-1.5 text-xs text-muted-foreground">&quot;-&quot; = not attempted. With OR questions, the better answer of each pair counts.</p>}
                  </div>
                )}
              </CardContent></Card>
            );
          })}
        </section>
      ))}
    </div>
  );
}
