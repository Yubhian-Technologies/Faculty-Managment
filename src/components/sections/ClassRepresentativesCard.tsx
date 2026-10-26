"use client";

import { useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { classRepresentativeCountOf, MAX_CLASS_REPRESENTATIVES } from "@/lib/sections/classRepresentatives";
import type { Section } from "@/types";

const NONE = "__none";

type CrSection = Pick<Section, "id" | "facultyInchargeName" | "classRepresentativeCount" | "classRepresentatives">;
type RosterStudent = { id?: string; name: string; rollNumber?: string };

/**
 * Total students / Class I/c / Class Representative-1 / -2 of a section. The HOD sets how many CRs the section
 * has (`canSetCount`); the faculty incharge (or the HOD) picks that many students from the section's roster.
 */
export function ClassRepresentativesCard({ section, students, canSetCount, onSaved }: {
  section: CrSection;
  students: RosterStudent[];
  canSetCount: boolean;
  onSaved: (patch: Pick<Section, "classRepresentativeCount" | "classRepresentatives">) => void;
}) {
  const count = classRepresentativeCountOf(section);
  const saved = useMemo(() => (section.classRepresentatives ?? []).map((r) => r.studentId), [section.classRepresentatives]);
  const [picks, setPicks] = useState<string[]>(saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPicks(saved); }, [saved, section.id]);

  const roster = useMemo(
    () => students.filter((s): s is RosterStudent & { id: string } => !!s.id)
      .sort((a, b) => (a.rollNumber ?? "").localeCompare(b.rollNumber ?? "", undefined, { numeric: true }) || a.name.localeCompare(b.name)),
    [students],
  );
  const label = (s: RosterStudent) => (s.rollNumber ? `${s.rollNumber} - ${s.name}` : s.name);
  const dirty = picks.length !== saved.length || picks.some((id, i) => id !== saved[i]);

  async function save(body: { count?: number; studentIds?: string[] }) {
    setBusy(true);
    try {
      const res = await fetch("/api/college/section-class-representatives", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId: section.id, ...body }),
      });
      const json = await res.json() as { error?: string; classRepresentativeCount?: number; classRepresentatives?: Section["classRepresentatives"] };
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      onSaved({ classRepresentativeCount: json.classRepresentativeCount, classRepresentatives: json.classRepresentatives });
      toast({ variant: "success", title: "Class Representatives saved" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  }

  function setSlot(i: number, value: string) {
    setPicks((prev) => {
      const next = [...prev];
      if (value === NONE) next.splice(i, 1);
      else next[i] = value;
      return next.filter(Boolean);
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />Class Representatives</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="space-y-1.5 text-sm">
          <div className="flex gap-2"><dt className="text-muted-foreground">Total No of students enrolled:</dt><dd className="font-medium">{students.length}</dd></div>
          <div className="flex gap-2"><dt className="text-muted-foreground">Class I/c:</dt><dd className="font-medium">{section.facultyInchargeName || "Not assigned"}</dd></div>
        </dl>

        {canSetCount && (
          <div className="space-y-1.5 max-w-xs">
            <Label>Number of Class Representatives</Label>
            <Select value={String(count)} onValueChange={(v) => void save({ count: Number(v) })} disabled={busy}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: MAX_CLASS_REPRESENTATIVES + 1 }, (_, n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {count === 0 ? (
          <p className="text-sm text-muted-foreground">This section has no Class Representatives set up.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="space-y-1.5">
                <Label>Class Representative-{i + 1}</Label>
                <Select value={picks[i] ?? NONE} onValueChange={(v) => setSlot(i, v)} disabled={busy || roster.length === 0}>
                  <SelectTrigger><SelectValue placeholder="Pick from the class list" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not selected</SelectItem>
                    {roster.filter((s) => s.id === picks[i] || !picks.includes(s.id)).map((s) => (
                      <SelectItem key={s.id} value={s.id}>{label(s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}

        {count > 0 && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save({ studentIds: picks })} disabled={busy || !dirty}>Save Class Representatives</Button>
            {dirty && <Button size="sm" variant="outline" onClick={() => setPicks(saved)} disabled={busy}>Cancel</Button>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
