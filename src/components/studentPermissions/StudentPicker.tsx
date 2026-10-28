"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { lookupRoster, lookupSearch, lookupSections, type PickerSection, type PickerStudent } from "./api";

// Faculty pick the students a request covers: browse a section's roster and tick
// people, or find someone by Regd. No - from any department. The selection is
// kept as a map so it survives switching section or searching.

export function StudentPicker({ selected, onChange, max }: { selected: PickerStudent[]; onChange: (s: PickerStudent[]) => void; max: number }) {
  const [sections, setSections] = useState<PickerSection[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [roster, setRoster] = useState<PickerStudent[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerStudent[]>([]);

  useEffect(() => {
    lookupSections().then(setSections).catch(() => toast({ variant: "destructive", title: "Couldn't load sections" }));
  }, []);

  const chosen = useMemo(() => new Map(selected.map((s) => [s.id, s])), [selected]);

  async function pickSection(id: string) {
    setSectionId(id);
    setLoading(true);
    try { setRoster(await lookupRoster(id)); }
    catch { toast({ variant: "destructive", title: "Couldn't load that section's students" }); setRoster([]); }
    finally { setLoading(false); }
  }

  async function search() {
    if (query.trim().length < 3) { toast({ title: "Type at least 3 characters of the Regd. No" }); return; }
    try { setResults(await lookupSearch(query.trim())); }
    catch { toast({ variant: "destructive", title: "Search failed" }); }
  }

  function toggle(s: PickerStudent, on: boolean) {
    if (on) {
      if (chosen.has(s.id)) return;
      if (selected.length >= max) { toast({ variant: "destructive", title: `At most ${max} students per request` }); return; }
      onChange([...selected, s]);
    } else onChange(selected.filter((x) => x.id !== s.id));
  }

  function toggleAll(on: boolean) {
    if (!on) { const ids = new Set(roster.map((r) => r.id)); onChange(selected.filter((s) => !ids.has(s.id))); return; }
    const add = roster.filter((r) => !chosen.has(r.id));
    if (selected.length + add.length > max) { toast({ variant: "destructive", title: `At most ${max} students per request` }); return; }
    onChange([...selected, ...add]);
  }

  const allTicked = roster.length > 0 && roster.every((r) => chosen.has(r.id));
  const sectionLabel = (s: PickerSection) => `${s.department} · ${s.courseName ?? s.courseId ?? ""} · Year ${s.year} · Section ${s.name}`.replace(/ · {2}/, " · ");

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Browse a section</Label>
          <Select value={sectionId} onValueChange={(v) => void pickSection(v)}>
            <SelectTrigger><SelectValue placeholder="Choose a section" /></SelectTrigger>
            <SelectContent className="max-h-72">{sections.map((s) => <SelectItem key={s.id} value={s.id}>{sectionLabel(s)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="roll-search">Or find by Regd. No</Label>
          <div className="flex gap-2">
            <Input id="roll-search" className="h-11 sm:h-9" value={query} placeholder="e.g. 23YEC" autoCapitalize="characters" enterKeyHint="search" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} />
            <Button type="button" variant="outline" className="h-11 w-11 shrink-0 p-0 sm:h-9 sm:w-9" onClick={() => void search()} aria-label="Search"><Search className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>

      {results.length > 0 && (
        <div className="rounded-md border p-1.5 space-y-0.5">
          <p className="text-xs font-medium text-muted-foreground px-2 pt-1">Search results</p>
          {results.map((s) => (
            <label key={s.id} className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 sm:min-h-9">
              <Checkbox checked={chosen.has(s.id)} onCheckedChange={(c) => toggle(s, !!c)} />
              <span className="font-mono text-xs">{s.rollNumber}</span><span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="basis-full pl-6 text-xs text-muted-foreground sm:ml-auto sm:basis-auto sm:pl-0">{s.department} · {s.section}</span>
            </label>
          ))}
        </div>
      )}

      {sectionId && (
        <div className="rounded-md border" aria-busy={loading}>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-medium sm:min-h-10">
            <Checkbox checked={allTicked} onCheckedChange={(c) => toggleAll(!!c)} disabled={loading || roster.length === 0} aria-label="Select all students in this section" />
            Select all {roster.length ? `(${roster.length})` : ""}
          </label>
          <div className="max-h-64 overflow-y-auto overscroll-contain p-1.5 space-y-0.5 sm:max-h-56">
            {loading && (
              <p className="text-sm text-muted-foreground px-1 animate-pulse" role="status">Loading students…</p>
            )}
            {!loading && roster.length === 0 && (
              <p className="text-sm text-muted-foreground px-1">No students in this section.</p>
            )}
            {roster.map((s) => (
              <label key={s.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 sm:min-h-9">
                <Checkbox checked={chosen.has(s.id)} onCheckedChange={(c) => toggle(s, !!c)} />
                <span className="font-mono text-xs">{s.rollNumber}</span><span className="min-w-0 flex-1 truncate">{s.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>
            Selected students
            <span className="text-destructive ml-0.5" aria-hidden>*</span>
          </Label>
          <span className={`text-xs ${selected.length >= max ? "text-amber-700 font-medium" : "text-muted-foreground"}`} role={selected.length >= max ? "status" : undefined}>
            {selected.length} / {max}{selected.length >= max ? " (limit reached)" : ""}
          </span>
        </div>
        {selected.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet — browse a section or search by Regd. No.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((s) => (
              <Badge key={s.id} variant="secondary" className="h-auto max-w-full gap-1 whitespace-normal break-words py-0.5 pr-0.5 text-left">
                {s.rollNumber} · {s.name}
                <button type="button" aria-label={`Remove ${s.name}`} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-5 sm:w-5" onClick={() => toggle(s, false)}><X className="h-3 w-3" /></button>
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
