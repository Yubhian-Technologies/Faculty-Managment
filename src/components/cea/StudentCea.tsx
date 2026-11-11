"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

// Student > CEA Marks: my Continuous Evaluation marks, unit by unit, once my teacher submits each unit.

type Subject = { subjectId: string; code: string; name: string; unitMarks: number; total: number; outOf: number; submittedUnits: number;
  units: { unit: number; title: string; type: string; when: string; marks: number | null; absent: boolean; submitted: boolean }[] };

export function StudentCea() {
  const [d, setD] = useState<Subject[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/college/student/me/cea").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Couldn't load"); setD(j.subjects); }).catch((e: Error) => setError(e.message));
  }, []);
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="CEA Marks" description="Continuous Evaluation: one assessment per unit. Marks appear once your teacher submits the unit; they add up into your internal marks." />
      {error ? <p className="text-sm text-destructive">{error}</p> : !d ? <div className="h-40 animate-pulse rounded-2xl bg-muted/40" /> : d.length === 0 ? (
        <p className="text-sm text-muted-foreground">No CEA marks yet.</p>
      ) : d.map((s) => (
        <Card key={s.subjectId} className="rounded-2xl"><CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold">{s.name} <span className="font-mono text-xs text-muted-foreground">{s.code}</span></p>
            <p className="text-sm">So far <span className="font-semibold tabular-nums">{s.total}</span> of {s.submittedUnits * s.unitMarks} <span className="text-muted-foreground">({s.submittedUnits} of {s.units.length} units)</span></p>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 pr-2">Unit</th><th className="py-1 pr-2">Assessment</th><th className="py-1 text-right">Marks</th></tr></thead>
            <tbody>{s.units.map((u) => (
              <tr key={u.unit} className="border-t">
                <td className="py-2 pr-2"><span className="font-medium">Unit {u.unit}</span>{u.title && <span className="text-muted-foreground"> · {u.title}</span>}</td>
                <td className="py-2 pr-2">{u.type} <span className="text-xs text-muted-foreground">{u.when}</span></td>
                <td className="py-2 text-right tabular-nums">{!u.submitted ? <span className="text-xs text-muted-foreground">Pending</span> : u.absent ? <span className="text-amber-700 dark:text-amber-300">Absent (0)</span> : <span className="font-semibold">{u.marks ?? "-"}</span>}<span className="text-xs text-muted-foreground"> / {s.unitMarks}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </CardContent></Card>
      ))}
    </div>
  );
}
