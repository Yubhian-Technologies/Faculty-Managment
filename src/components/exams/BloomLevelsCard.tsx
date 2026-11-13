"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/useToast";
import { BLOOM_MIN_MAX, BLOOM_NAME_MAX, DEFAULT_BLOOM_LEVELS, STANDARD_BLOOM, type BloomLevelDef } from "@/lib/midBank/bloom";
import type { BloomLevel } from "@/types";

// Exam Cell: the Bloom's levels every Mid question in the college uses - which of the standard six, each one's name,
// and (question bank colleges) how many questions of each level a unit needs. Banks / papers already started keep the
// list they started with.

type Row = { id: BloomLevel; on: boolean; name: string; min: string };
const toRows = (levels: BloomLevelDef[]): Row[] => STANDARD_BLOOM.map((s) => {
  const l = levels.find((x) => x.id === s.id);
  return { id: s.id, on: !!l, name: l?.name ?? s.name, min: String(l?.min ?? 0) };
});

export function BloomLevelsCard({ bank }: { /** Question bank college: the per-unit minimums apply. */ bank: boolean }) {
  const [rows, setRows] = useState<Row[]>(() => toRows(DEFAULT_BLOOM_LEVELS));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/college/exam-mid-settings").then((r) => (r.ok ? r.json() : null))
      .then((d: { settings?: { bloomLevels?: BloomLevelDef[] } } | null) => { if (d?.settings?.bloomLevels?.length) setRows(toRows(d.settings.bloomLevels)); })
      .catch(() => undefined);
  }, []);

  const set = (id: BloomLevel, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.on);
  const total = chosen.reduce((n, r) => n + (Number(r.min) || 0), 0);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/college/exam-mid-settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bloomLevels: chosen.map((r) => ({ id: r.id, name: r.name, min: bank ? Number(r.min) : 0 })) }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Unable to save");
      toast({ variant: "success", title: "Bloom's levels saved" });
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save" }); }
    finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bloom&rsquo;s levels</CardTitle>
        <CardDescription>
          The levels every Mid question in the college can carry, and their names.{bank ? " A unit of a question bank is complete only when each level has at least its minimum." : ""} Banks and papers already started keep the levels they started with.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[30rem] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="p-2">Use</th><th className="p-2">Level</th><th className="p-2">Name</th>{bank && <th className="p-2">Min per unit</th>}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2"><Checkbox aria-label={`Use ${r.id}`} checked={r.on} onCheckedChange={(v) => set(r.id, { on: v === true })} /></td>
                  <td className="p-2 font-semibold">{r.id}</td>
                  <td className="p-2"><Input aria-label={`${r.id} name`} className="h-8" maxLength={BLOOM_NAME_MAX} value={r.name} disabled={!r.on} onChange={(e) => set(r.id, { name: e.target.value })} /></td>
                  {bank && <td className="w-32 p-2"><Input aria-label={`${r.id} minimum per unit`} className="h-8" inputMode="numeric" value={r.min} disabled={!r.on} onChange={(e) => set(r.id, { min: e.target.value.replace(/\D/g, "").slice(0, 2) })} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {chosen.length === 0 && <p className="text-xs text-amber-700">Pick at least one level.</p>}
        {bank && total > 10 && <p className="text-xs text-amber-700">The minimums add up to {total} - more than the 10 questions of a unit.</p>}
        {bank && chosen.some((r) => Number(r.min) > BLOOM_MIN_MAX) && <p className="text-xs text-amber-700">A minimum can be at most {BLOOM_MIN_MAX}.</p>}
        <div className="flex justify-end">
          <Button onClick={() => void save()} loading={saving} disabled={chosen.length === 0 || (bank && total > 10)}>Save Bloom&rsquo;s levels</Button>
        </div>
      </CardContent>
    </Card>
  );
}
