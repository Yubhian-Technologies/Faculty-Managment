"use client";

import { useState } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  RESUME_SECTIONS, RESUME_SECTION_KEYS, DEFAULT_RESUME_SECTIONS, type ResumeSectionKey,
} from "@/lib/pdf/resumeSections";

interface Props {
  /** Whose resume - shown in the dialog so it's clear which row was clicked. */
  personName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the chosen sections, in the resume's own order. */
  onDownload: (sections: ResumeSectionKey[]) => void | Promise<void>;
  downloading?: boolean;
}

// The resume counterpart of ExportFacultyDialog: pick what goes in before the
// file is generated, rather than always producing the same fixed document.
//
// It offers SECTIONS, not individual fields as the CSV export does - a resume
// section is a heading plus its own entries, and half of one reads as a
// mistake rather than a choice. Ticking nothing is prevented for the same
// reason: an empty resume is never what someone meant.
export function ResumeSectionsDialog({
  personName, open, onOpenChange, onDownload, downloading,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(DEFAULT_RESUME_SECTIONS));

  function handleOpenChange(next: boolean) {
    // Reset on each open so one person's choice never silently carries over
    // to the next row's download.
    if (next) setSelected(new Set(DEFAULT_RESUME_SECTIONS));
    onOpenChange(next);
  }

  function toggle(key: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key); else next.delete(key);
      return next;
    });
  }

  const chosen = RESUME_SECTION_KEYS.filter((k) => selected.has(k));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Download Resume</DialogTitle>
          <DialogDescription>
            {chosen.length} of {RESUME_SECTIONS.length} sections selected for {personName}. A section with no
            data for this person is left out automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-3 text-sm">
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => setSelected(new Set(RESUME_SECTION_KEYS))}
          >
            Select All
          </button>
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => setSelected(new Set())}
          >
            Clear All
          </button>
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => setSelected(new Set(DEFAULT_RESUME_SECTIONS))}
          >
            Reset to Defaults
          </button>
        </div>

        <div className="rounded-md border p-3 space-y-2.5 max-h-[50vh] overflow-y-auto">
          {RESUME_SECTIONS.map((s) => (
            <label key={s.key} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.has(s.key)}
                onCheckedChange={(c) => toggle(s.key, !!c)}
              />
              {s.label}
              {s.key === "financial" && (
                <span className="text-xs text-muted-foreground">(salary &amp; CTC - off by default)</span>
              )}
            </label>
          ))}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button
            loading={downloading}
            disabled={chosen.length === 0}
            onClick={() => void onDownload(chosen)}
          >
            <FileDown className="h-4 w-4 mr-2" />
            Download Resume
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
