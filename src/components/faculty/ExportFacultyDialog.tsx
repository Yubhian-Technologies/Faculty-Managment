"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { EXPORT_FIELDS, EXPORT_MODULE_ORDER, EXPORT_MODULE_LABELS, type ExportModuleKey } from "@/lib/faculty/csvColumns";
import { exportFacultyCsv } from "@/lib/faculty/exportFacultyCsv";
import type { FacultyMember, TeachingAssignment } from "@/types";

interface Props {
  faculty: FacultyMember[];
}

const DEFAULT_SELECTED = EXPORT_FIELDS.filter((f) => f.defaultSelected).map((f) => f.key);

const FIELDS_BY_MODULE = new Map(
  EXPORT_MODULE_ORDER.map((m) => [m, EXPORT_FIELDS.filter((f) => f.module === m)])
);

// Lets the HOD pick exactly which fields (grouped the same way a faculty
// profile itself is organized into tabs - Identity & Employment, Personal
// Details, Academic Qualification, Professional Experience, ...) go into the
// exported CSV, instead of always downloading the same fixed set. A
// repeating field (e.g. Ph.D. Details, Previous Experience) is a single
// checkbox whose exported column combines every one of that faculty
// member's entries into one cell - see exportFacultyCsv.ts's combineGroup.
export function ExportFacultyDialog({ faculty }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(DEFAULT_SELECTED));
  const [activeModule, setActiveModule] = useState<ExportModuleKey>("core");
  const [exporting, setExporting] = useState(false);

  function handleOpenChange(next: boolean) {
    if (next) {
      setSelected(new Set(DEFAULT_SELECTED));
      setActiveModule("core");
    }
    setOpen(next);
  }

  function toggle(key: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key); else next.delete(key);
      return next;
    });
  }

  function selectAllInModule(module: ExportModuleKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      (FIELDS_BY_MODULE.get(module) ?? []).forEach((f) => next.add(f.key));
      return next;
    });
  }

  function clearModule(module: ExportModuleKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      (FIELDS_BY_MODULE.get(module) ?? []).forEach((f) => next.delete(f.key));
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(EXPORT_FIELDS.map((f) => f.key)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  function resetToDefaults() {
    setSelected(new Set(DEFAULT_SELECTED));
  }

  const activeFields = FIELDS_BY_MODULE.get(activeModule) ?? [];
  const activeSelectedCount = activeFields.filter((f) => selected.has(f.key)).length;

  async function handleExport() {
    setExporting(true);
    try {
      const teachingSummaries: Record<string, string> = {};
      try {
        const res = await fetch("/api/college/teaching-assignments?dept=true");
        const data = await res.json() as { assignments?: TeachingAssignment[] };
        for (const a of data.assignments ?? []) {
          const entry = `${a.courseName} Y${a.year}-${a.sectionName}: ${a.subjectName}`;
          teachingSummaries[a.facultyId] = teachingSummaries[a.facultyId] ? `${teachingSummaries[a.facultyId]}; ${entry}` : entry;
        }
      } catch { /* export still proceeds without the teaching summary column */ }

      exportFacultyCsv(faculty, teachingSummaries, Array.from(selected));
      setOpen(false);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to export faculty details" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={faculty.length === 0}>
          <Download className="h-4 w-4 mr-2" />Export Faculty Details
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export Faculty Details</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs text-muted-foreground">
            {selected.size} of {EXPORT_FIELDS.length} fields selected. A field that repeats (e.g. Ph.D. Details) exports every entry in one column.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={selectAll}>Select All</Button>
            <Button type="button" variant="ghost" size="sm" onClick={clearAll}>Clear All</Button>
            <Button type="button" variant="ghost" size="sm" onClick={resetToDefaults}>Reset to Defaults</Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b pb-3">
          {EXPORT_MODULE_ORDER.map((m) => {
            const fields = FIELDS_BY_MODULE.get(m) ?? [];
            const checkedCount = fields.filter((f) => selected.has(f.key)).length;
            const isActive = m === activeModule;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setActiveModule(m)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap border",
                  isActive ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-transparent hover:text-foreground"
                )}
              >
                {EXPORT_MODULE_LABELS[m]}
                {checkedCount > 0 && <span className="ml-1 opacity-80">({checkedCount})</span>}
              </button>
            );
          })}
        </div>

        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{EXPORT_MODULE_LABELS[activeModule]}</p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => selectAllInModule(activeModule)} disabled={activeSelectedCount === activeFields.length}>
                Select all
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => clearModule(activeModule)} disabled={activeSelectedCount === 0}>
                Clear
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 border rounded-md px-3 py-2">
            {activeFields.map((f) => (
              <label key={f.key} className="flex items-center gap-1.5 text-sm min-w-[45%]">
                <Checkbox checked={selected.has(f.key)} onCheckedChange={(checked) => toggle(f.key, !!checked)} />
                {f.label}
                {f.kind === "group" && <span className="text-xs text-muted-foreground">(combined)</span>}
              </label>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => void handleExport()} loading={exporting} disabled={selected.size === 0}>
            Export CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
