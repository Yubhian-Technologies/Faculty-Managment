"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Save, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import { DEFAULT_TIMETABLE_RULES, DAY_LABELS } from "@/types";
import type { DayOfWeek, TimetableRules } from "@/types";

// Per-college scheduling constraints. Collapsed by default - the HOD only needs
// this when the college's rules differ from the defaults.

const ALL_DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];

const NUMBER_FIELDS: { key: keyof TimetableRules; label: string; hint: string; min: number; max: number }[] = [
  { key: "maxPeriodsPerFacultyPerDay", label: "Max periods per faculty per day", hint: "Hard cap on a single teacher's daily load", min: 1, max: 12 },
  { key: "maxConsecutivePeriodsPerFaculty", label: "Max back-to-back periods", hint: "Consecutive periods one teacher may take", min: 1, max: 12 },
  { key: "maxPeriodsPerSubjectPerDay", label: "Max periods per subject per day", hint: "Usually 1 for theory; labs are exempt", min: 1, max: 6 },
  { key: "labBlockSize", label: "Lab block size", hint: "Continuous periods a lab occupies", min: 1, max: 6 },
];

export function TimetableRulesPanel() {
  const [rules, setRules] = useState<TimetableRules>(DEFAULT_TIMETABLE_RULES);
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDefault, setIsDefault] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/college/settings/timetable-rules")
      .then((r) => r.json() as Promise<{ rules: TimetableRules; isDefault: boolean }>)
      .then((d) => {
        if (cancelled) return;
        if (d.rules) setRules(d.rules);
        setIsDefault(Boolean(d.isDefault));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function setNumber(key: keyof TimetableRules, raw: string) {
    const n = Number(raw);
    setRules((r) => ({ ...r, [key]: Number.isFinite(n) ? n : 0 }));
  }

  function toggleDay(day: DayOfWeek) {
    setRules((r) => ({
      ...r,
      workingDays: r.workingDays.includes(day)
        ? r.workingDays.filter((d) => d !== day)
        : ALL_DAYS.filter((d) => d === day || r.workingDays.includes(d)),
    }));
  }

  async function save() {
    if (rules.workingDays.length === 0) {
      toast({ variant: "destructive", title: "Pick at least one working day" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/settings/timetable-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rules),
      });
      const json = (await res.json()) as { rules?: TimetableRules; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Could not save rules" });
        return;
      }
      if (json.rules) setRules(json.rules);
      setIsDefault(false);
      toast({ variant: "success", title: "Timetable rules saved", description: "They apply the next time a timetable is generated." });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 p-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          Timetable Rules
          {isDefault && !isLoading && (
            <span className="text-xs font-normal text-muted-foreground">(using defaults)</span>
          )}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t p-4 space-y-5">
          <p className="text-xs text-muted-foreground">
            These constraints vary between colleges. The generator treats the caps and the lab
            block as hard rules - it fails with an explanation rather than breaking them.
          </p>

          <div>
            <Label className="text-sm">Working days</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {ALL_DAYS.map((d) => {
                const on = rules.workingDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={[
                      "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                      on ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/40",
                    ].join(" ")}
                  >
                    {DAY_LABELS[d].slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {NUMBER_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={f.key}>{f.label}</Label>
                <Input
                  id={f.key}
                  type="number"
                  min={f.min}
                  max={f.max}
                  value={String(rules[f.key] ?? "")}
                  onChange={(e) => setNumber(f.key, e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{f.hint}</p>
              </div>
            ))}
          </div>

          <div className="space-y-2.5">
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox
                checked={rules.allowLabAcrossBreaks}
                onCheckedChange={(v) => setRules((r) => ({ ...r, allowLabAcrossBreaks: Boolean(v) }))}
              />
              <span>
                Allow a lab block to span a break
                <span className="block text-xs text-muted-foreground">Off by default - a lab interrupted by lunch is usually not workable.</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox
                checked={rules.preferTheoryInMorning}
                onCheckedChange={(v) => setRules((r) => ({ ...r, preferTheoryInMorning: Boolean(v) }))}
              />
              <span>
                Prefer theory in the morning
                <span className="block text-xs text-muted-foreground">Soft preference - never blocks a valid timetable.</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox
                checked={rules.spreadSubjectsAcrossWeek}
                onCheckedChange={(v) => setRules((r) => ({ ...r, spreadSubjectsAcrossWeek: Boolean(v) }))}
              />
              <span>
                Spread each subject across the week
                <span className="block text-xs text-muted-foreground">Soft preference - avoids clustering one subject on a single day.</span>
              </span>
            </label>
          </div>

          <div className="flex justify-end">
            <Button onClick={save} loading={isSaving} disabled={isLoading}>
              <Save className="h-4 w-4 mr-2" />Save rules
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
