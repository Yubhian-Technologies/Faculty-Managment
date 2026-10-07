"use client";

import { useState } from "react";
import { Palette, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HIGHLIGHT_COLORS, type HighlightColorKey, type SubjectHighlights } from "@/lib/timetable/highlightColors";

interface Props {
  subjects: { code: string; name: string }[];
  value: SubjectHighlights;
  onChange: (next: SubjectHighlights) => void;
}

// Pick ONE subject, pick a colour, Add - only the subjects given a colour are
// listed afterwards, never every subject with every colour.
export function SubjectColorPicker({ subjects, value, onChange }: Props) {
  const [code, setCode] = useState("");
  const [color, setColor] = useState<HighlightColorKey>("purple");
  const assigned = Object.entries(value);
  const nameOf = (c: string) => subjects.find((s) => s.code === c)?.name ?? c;

  function add() {
    if (!code) return;
    onChange({ ...value, [code]: color });
    setCode("");
  }
  function remove(c: string) {
    const next = { ...value };
    delete next[c];
    onChange(next);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Palette className="h-3.5 w-3.5 text-purple-600" />
          Highlight Subjects{assigned.length > 0 ? ` (${assigned.length})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        <Select value={code} onValueChange={setCode} disabled={subjects.length === 0}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={subjects.length === 0 ? "No subjects" : "Select a subject"} /></SelectTrigger>
          <SelectContent>
            {subjects.map((s) => <SelectItem key={s.code} value={s.code} className="text-xs">{s.name} ({s.code})</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1.5">
            {(Object.keys(HIGHLIGHT_COLORS) as HighlightColorKey[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-label={HIGHLIGHT_COLORS[k].label}
                title={HIGHLIGHT_COLORS[k].label}
                onClick={() => setColor(k)}
                className={`h-5 w-5 rounded-full border-2 ${color === k ? "ring-2 ring-offset-1 ring-foreground/60" : ""}`}
                style={{ background: HIGHLIGHT_COLORS[k].bg, borderColor: HIGHLIGHT_COLORS[k].border }}
              />
            ))}
          </div>
          <Button size="sm" className="h-7 text-xs" onClick={add} disabled={!code}>Add</Button>
        </div>
        {assigned.length > 0 && (
          <div className="space-y-1 border-t pt-2">
            {assigned.map(([c, k]) => (
              <div key={c} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs" style={{ background: HIGHLIGHT_COLORS[k].bg, color: HIGHLIGHT_COLORS[k].text }}>
                <span className="min-w-0 flex-1 truncate font-medium">{nameOf(c)}</span>
                <button type="button" aria-label={`Remove ${c}`} onClick={() => remove(c)}><X className="h-3 w-3" /></button>
              </div>
            ))}
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-muted-foreground" onClick={() => onChange({})}>Clear all</Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
