"use client";

import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Pencil } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { DAY_LABELS, type DayOfWeek } from "@/types";

// Students -> Lab Batches: periods where two labs of the section run side by side (Physics lab + Chemistry lab in
// Monday's periods 5-7). The class in-charge decides which batch goes to which lab in each period - the same every
// week (Batch 1 -> Physics, Batch 2 -> Chemistry on Monday; swapped on Thursday). Each lab's faculty then marks
// only that batch (lib/students/labPeriodBatches.ts, effectiveLabBatch).

interface PeriodLab { subjectId: string; subjectName: string; subjectCode: string; batch: string | null }
interface LabPeriod { key: string; day: DayOfWeek; periodNumber: number; labs: PeriodLab[] }
/** Consecutive periods of one day with the same labs and the same choices - shown and saved as one row. */
interface Block { id: string; day: DayOfWeek; from: number; to: number; keys: string[]; labs: PeriodLab[] }

const sig = (p: LabPeriod) => p.labs.map((l) => `${l.subjectId}:${(l.batch ?? "").toLowerCase()}`).join("|");

function toBlocks(periods: LabPeriod[]): Block[] {
  const out: Block[] = [];
  for (const p of periods) {
    const last = out[out.length - 1];
    if (last && last.day === p.day && last.to === p.periodNumber - 1 && sig({ ...p, labs: last.labs }) === sig(p)) {
      last.to = p.periodNumber; last.keys.push(p.key);
    } else {
      out.push({ id: p.key, day: p.day, from: p.periodNumber, to: p.periodNumber, keys: [p.key], labs: p.labs });
    }
  }
  return out;
}

export function LabPeriodBatches({ sectionId }: { sectionId: string }) {
  const [periods, setPeriods] = useState<LabPeriod[] | null>(null);
  const [batches, setBatches] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/college/section-lab-batch-settings?sectionId=${encodeURIComponent(sectionId)}`);
        const json = (await res.json()) as { periods?: LabPeriod[]; batches?: string[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Unable to load the lab periods.");
        if (!cancelled) { setPeriods(json.periods ?? []); setBatches(json.batches ?? []); }
      } catch (err) {
        if (cancelled) return;
        setPeriods([]);
        toast({ variant: "destructive", title: err instanceof Error ? err.message : "Unable to load the lab periods." });
      }
    })();
    return () => { cancelled = true; };
  }, [sectionId]);

  const blocks = useMemo(() => toBlocks(periods ?? []), [periods]);
  if (!periods || periods.length === 0) return null;
  const unset = blocks.filter((b) => b.labs.some((l) => !l.batch)).length;

  const start = (b: Block) => { setEditing(b.id); setDraft(Object.fromEntries(b.labs.map((l) => [l.subjectId, l.batch]))); };
  const pick = (subjectId: string, batch: string) => setDraft((d) => {
    const next = { ...d };
    // A batch goes to one lab per period: picking it here takes it off the other lab.
    for (const [id, b] of Object.entries(next)) if (id !== subjectId && b && b.toLowerCase() === batch.toLowerCase()) next[id] = null;
    next[subjectId] = d[subjectId] === batch ? null : batch;
    return next;
  });

  async function save(b: Block) {
    setSaving(true);
    try {
      const res = await fetch("/api/college/section-lab-batch-settings/periods", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId, choices: Object.fromEntries(b.keys.map((k) => [k, draft])) }),
      });
      const json = (await res.json()) as { periods?: LabPeriod[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Unable to save the lab batches.");
      setPeriods(json.periods ?? []);
      setEditing(null);
      toast({ variant: "success", title: "Lab batches for the period saved." });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Unable to save the lab batches." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="h-4 w-4" />Labs in the Same Period</CardTitle>
        <CardDescription>
          These periods have two labs running together. Choose which batch goes to which lab in each one; it stays the same every week.
          Each lab&apos;s faculty then marks only their batch, and students see only their own lab.
          {unset > 0 && <span className="mt-1 block font-medium text-amber-700 dark:text-amber-300">{unset} period{unset === 1 ? "" : "s"} still need a choice - until then the lab faculty can&apos;t mark attendance there.</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {batches.length < 2 && (
          <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            Divide the section into at least two batches above first; they then appear here.
          </p>
        )}
        {blocks.map((b) => {
          const isEditing = editing === b.id;
          const when = `${DAY_LABELS[b.day]} · ${b.from === b.to ? `Period ${b.from}` : `Periods ${b.from}-${b.to}`}`;
          return (
            <div key={b.id} className={cn("rounded-lg border p-3", isEditing && "border-primary")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{when}</p>
                {!isEditing ? (
                  <Button size="sm" variant="outline" disabled={editing !== null || batches.length < 2} onClick={() => start(b)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={saving} onClick={() => setEditing(null)}>Cancel</Button>
                    <Button size="sm" loading={saving} onClick={() => void save(b)}>Save</Button>
                  </div>
                )}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {b.labs.map((l) => {
                  const chosen = isEditing ? draft[l.subjectId] : l.batch;
                  return (
                    <div key={l.subjectId} className="rounded-md bg-muted/30 px-3 py-2">
                      <p className="text-sm">{l.subjectName} <span className="font-mono text-xs text-muted-foreground">{l.subjectCode}</span></p>
                      {isEditing ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {batches.map((batch) => (
                            <button key={batch} type="button" onClick={() => pick(l.subjectId, batch)} aria-pressed={chosen === batch}
                              className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                                chosen === batch ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary")}>{batch}</button>
                          ))}
                        </div>
                      ) : chosen ? (
                        <Badge variant="approved" className="mt-1 text-[10px]">{chosen}</Badge>
                      ) : (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">No batch chosen</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
