"use client";

import { useMemo, useState } from "react";
import { FlaskConical, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { areaMatchesTerm, parseResearchQuery, researchAreaOptions } from "@/lib/faculty/researchAreas";

type Row = Record<string, unknown>;

// The "Research area" filter pill that sits with the other list filters (Gender / Qualification / ...). It is its own filter, so
// the page's name search box is untouched. Off: a pill that opens a small finder - type a few letters (or "ml/ds" for several) to
// narrow the research areas the list actually holds, then pick one or search for what was typed. On: a blue pill naming the search;
// touch it to turn the filter off.
export function ResearchAreaFilter({ faculty, value, onChange }: { faculty: Row[]; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const options = useMemo(() => researchAreaOptions(faculty), [faculty]);
  const terms = useMemo(() => parseResearchQuery(text), [text]);
  const shown = useMemo(
    () => (terms.length === 0 ? options : options.filter((o) => terms.some((t) => areaMatchesTerm(o.label, t)))).slice(0, 30),
    [options, terms],
  );

  function apply(v: string) {
    onChange(v.trim());
    setOpen(false);
    setText("");
  }

  if (value) {
    return (
      <button
        type="button"
        title="Turn off the research area filter"
        aria-label={`Research area: ${value} - turn off`}
        onClick={() => onChange("")}
        className="flex h-9 max-w-[16rem] items-center gap-2 rounded-full border border-primary bg-primary px-3 text-sm text-primary-foreground"
      >
        <FlaskConical className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Research: {value}</span>
        <X className="h-3.5 w-3.5 shrink-0" />
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setText(""); }}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Research area" className="flex h-9 items-center gap-2 rounded-full border border-border bg-background px-3 text-sm hover:bg-muted">
          <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
          Research area
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 opacity-50" />
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && terms.length > 0) { e.preventDefault(); apply(text); } }}
            placeholder="Type a research area, e.g. ML or ML/DS"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {terms.length > 0 && (
            <button type="button" onClick={() => apply(text)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-primary hover:bg-muted">
              <Search className="h-3.5 w-3.5" />
              <span className="truncate">Find faculty for &ldquo;{text.trim()}&rdquo;</span>
            </button>
          )}
          {shown.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {options.length === 0 ? "No research areas have been entered for this list yet." : "No research area matches that."}
            </p>
          ) : (
            <>
              <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {terms.length > 0 ? "Matching research areas" : "Research areas in this list"}
              </p>
              {shown.map((o) => (
                <button key={o.key} type="button" onClick={() => apply(o.label)} className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
                  <span className="truncate">{o.label}</span>
                  <span className="shrink-0 rounded-full bg-muted px-2 text-xs tabular-nums text-muted-foreground">{o.count}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
