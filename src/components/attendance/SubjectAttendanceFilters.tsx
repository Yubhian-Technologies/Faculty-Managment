"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { hasSubjectFilters, NO_SUBJECT_FILTERS, type SubjectFilters } from "@/lib/studentAttendance/subjectFilters";

// Narrows an already-loaded per-subject attendance table (one student) - by
// subject, shortage, or a percentage band. Purely client-side: nothing refetches.
export function SubjectAttendanceFilters({
  subjects,
  value,
  onChange,
  threshold,
}: {
  subjects: { id: string; name: string }[];
  value: SubjectFilters;
  onChange: (f: SubjectFilters) => void;
  threshold: number;
}) {
  const toggle = (id: string) => {
    const current = value.subjectIds ?? subjects.map((s) => s.id);
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    onChange({ ...value, subjectIds: next.length === subjects.length ? null : next });
  };
  const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Math.min(100, Math.max(0, Number(v))));

  return (
    <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-3 sm:p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.shortageOnly}
            onChange={(e) => onChange({ ...value, shortageOnly: e.target.checked })}
          />
          Below {threshold}% only
        </label>
        <div className="w-24 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Min %</label>
          <Input type="number" min={0} max={100} value={value.minPercent ?? ""} onChange={(e) => onChange({ ...value, minPercent: num(e.target.value) })} />
        </div>
        <div className="w-24 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Max %</label>
          <Input type="number" min={0} max={100} value={value.maxPercent ?? ""} onChange={(e) => onChange({ ...value, maxPercent: num(e.target.value) })} />
        </div>
        {hasSubjectFilters(value) && (
          <Button variant="ghost" size="sm" onClick={() => onChange(NO_SUBJECT_FILTERS)}>Clear filters</Button>
        )}
      </div>
      {subjects.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {subjects.map((s) => {
            const on = !value.subjectIds || value.subjectIds.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggle(s.id)}
                className={`rounded-full border px-3 py-1 text-xs ${on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
